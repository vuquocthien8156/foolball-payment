const { groupKindOf, groupIdOf, isValidGroupId } = require("./groups");
const { enqueueBillNotifications, reminderText, localDate } = require("./billNotifications");

const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function requireDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) reject(400, "INVALID_DATE");
  return value;
}

function splitBill({ amountVnd, participants, providerPayerMemberId, autoCoverPayer = true }) {
  if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0 || !Array.isArray(participants) ||
      participants.length === 0 || participants.length > 50 || amountVnd < participants.length) reject(400, "INVALID_SPLIT");
  if (participants.some((p) => !validId(p.id) || typeof p.name !== "string") ||
      new Set(participants.map((p) => p.id)).size !== participants.length ||
      !participants.some((p) => p.id === providerPayerMemberId)) reject(400, "INVALID_PARTICIPANTS");
  const base = Math.floor(amountVnd / participants.length);
  const remainder = amountVnd % participants.length;
  return [...participants].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((member, index) => ({
    memberId: member.id, name: member.name, amountVnd: base + (index < remainder ? 1 : 0),
    state: (member.id === providerPayerMemberId && autoCoverPayer) ? "covered_by_payer" : "unpaid",
  }));
}

function billSummary(allocations) {
  const sum = (state) => allocations.filter((a) => a.state === state).reduce((total, a) => total + a.amountVnd, 0);
  const confirmedReimbursements = sum("paid");
  const outstanding = sum("unpaid");
  return { payerContribution: sum("covered_by_payer"), expectedReimbursements: confirmedReimbursements + outstanding, confirmedReimbursements, outstanding };
}

function createBillService({ db, FieldValue, now = () => new Date() }) {
  const groupRef = (gid) => db.collection("groups").doc(gid);
  const billRef = (gid, bid) => {
    if (!isValidGroupId(gid) || !validId(bid)) reject(400, "INVALID_BILL_ID");
    return groupRef(gid).collection("bills").doc(bid);
  };
  const checkGroup = (snap) => {
    if (!snap.exists) reject(404, "GROUP_NOT_FOUND");
    if (groupKindOf(snap.data()) !== "shared_bills") reject(400, "BILLS_NOT_SUPPORTED");
    if (snap.data().status !== "active") reject(403, "GROUP_INACTIVE");
  };
  const readDocs = (snap) => snap.docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, ...data,
      ...(data.createdAt ? { createdAt: { seconds: data.createdAt.seconds } } : {}),
      ...(data.paidAt ? { paidAt: { seconds: data.paidAt.seconds } } : {}),
    };
  });

  async function create({ groupId, billId, input, actorUid, occurrence = null }) {
    const ref = billRef(groupId, billId);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > 100) reject(400, "INVALID_TITLE");
    if (input.reminderHour !== undefined && (!Number.isInteger(input.reminderHour) || input.reminderHour < 0 || input.reminderHour > 23)) reject(400, "INVALID_REMINDER_HOUR");
    if (input.reminderMode !== undefined && !["default", "bill_only", "full", "none"].includes(input.reminderMode)) reject(400, "INVALID_REMINDER_MODE");
    const reminderMode = ["default", "bill_only", "full", "none"].includes(input.reminderMode) ? input.reminderMode : "default";
    const billingDate = requireDate(input.billingDate), dueDate = requireDate(input.dueDate);
    if (dueDate < billingDate) reject(400, "INVALID_DUE_DATE");
    if (!Array.isArray(input.participantIds) || input.participantIds.length === 0 || input.participantIds.length > 50 ||
        !input.participantIds.every(validId) || new Set(input.participantIds).size !== input.participantIds.length) reject(400, "INVALID_PARTICIPANTS");
    return db.runTransaction(async (tx) => {
      const [group, existing, ...members] = await tx.getAll(groupRef(groupId), ref,
        ...input.participantIds.map((id) => db.collection("members").doc(id)));
      checkGroup(group);
      let subscriptionRef;
      if (occurrence) {
        subscriptionRef = groupRef(groupId).collection("subscriptions").doc(occurrence.subscriptionId);
        const subscription = await tx.get(subscriptionRef);
        const schedule = subscription.data();
        if (!schedule?.enabled || schedule.revision !== occurrence.revision || schedule.nextPeriod !== occurrence.periodKey) reject(409, "SUBSCRIPTION_CHANGED");
      }
      if (existing.exists) {
        const prior = existing.data();
        if (prior.title !== title || prior.amountVnd !== input.amountVnd || prior.billingDate !== billingDate || prior.dueDate !== dueDate ||
            prior.providerPayerMemberId !== input.providerPayerMemberId ||
            prior.participantSnapshots.map((item) => item.memberId).sort().join() !== [...input.participantIds].sort().join()) reject(409, "REQUEST_ID_REUSED");
        return { id: ref.id, duplicate: true };
      }
      if (members.some((m) => !m.exists || groupIdOf(m.data()) !== groupId || m.data().inactive)) reject(400, "INVALID_PARTICIPANTS");
      const payerDoc = members.find((m) => m.id === input.providerPayerMemberId);
      const settlementMode = input.settlementMode || "net_offset";
      const autoCoverPayer = settlementMode === "net_offset";
      const allocations = splitBill({ amountVnd: input.amountVnd, participants: members.map((m) => ({ id: m.id, name: m.data().name })), providerPayerMemberId: input.providerPayerMemberId, autoCoverPayer });
      const [telegram, slack] = await tx.getAll(groupRef(groupId).collection("settings").doc("telegram"), groupRef(groupId).collection("settings").doc("slack"));
      const timestamp = FieldValue.serverTimestamp();
      const groupData = group.data();
      const groupOwnerUid = groupData.ownerUid || groupData.createdBy;
      let isDirectGroup = false;
      if (groupOwnerUid) {
        const ownerAcc = await tx.get(db.collection("platformAccounts").doc(groupOwnerUid));
        if (ownerAcc.exists && ownerAcc.data().role === "owner") {
          isDirectGroup = true;
        }
      }
      const payerName = payerDoc?.data()?.name || "Người ứng tiền";
      const payoutAmount = settlementMode === "full_collection"
        ? input.amountVnd
        : allocations.filter((a) => a.memberId !== input.providerPayerMemberId).reduce((s, a) => s + a.amountVnd, 0);

      const reconciliation = isDirectGroup
        ? {
            tier1Payout: {
              status: "PENDING_COLLECTION",
              recipientRole: "DIRECT_MEMBER",
              recipientMemberId: input.providerPayerMemberId,
              recipientName: payerName,
              amountVnd: payoutAmount,
              bankInfo: payerDoc?.data()?.bankInfo || null,
            },
          }
        : {
            tier1Payout: {
              status: "PENDING_COLLECTION",
              recipientRole: "GROUP_MANAGER",
              recipientUidOrMemberId: groupOwnerUid,
              recipientName: groupData.ownerDisplayName || "Quản trị viên nhóm",
              amountVnd: payoutAmount,
            },
            tier2Payout: {
              status: "PENDING",
              memberId: input.providerPayerMemberId,
              memberName: payerName,
              amountVnd: payoutAmount,
              bankInfo: payerDoc?.data()?.bankInfo || null,
            },
          };

      tx.set(ref, { groupId, title, amountVnd: input.amountVnd, currency: "VND", billingDate, dueDate,
        reminderHour: input.reminderHour ?? 9,
        reminderMode,
        settlementMode,
        reconciliation,
        providerPayerMemberId: input.providerPayerMemberId, source: occurrence ? "subscription" : "one_time",
        ...(occurrence ? { subscriptionId: occurrence.subscriptionId, subscriptionRevision: occurrence.revision, periodKey: occurrence.periodKey,
          catchupPending: billingDate < localDate(now()) } : {}),
        state: allocations.some((a) => a.state === "unpaid") ? "open" : "closed",
        participantSnapshots: allocations, createdBy: actorUid, createdAt: timestamp });
      for (const allocation of allocations) tx.set(ref.collection("allocations").doc(allocation.memberId), {
        ...allocation, ...(allocation.state === "covered_by_payer" ? { coveredAt: timestamp } : {}),
      });
      tx.set(ref.collection("events").doc("created"), { type: "created", actorUid, amountVnd: input.amountVnd, createdAt: timestamp });
      if (subscriptionRef) tx.update(subscriptionRef, { nextPeriod: occurrence.nextPeriod, lastError: null, lastGeneratedBillId: ref.id, lastGeneratedAt: timestamp });
      enqueueBillNotifications(tx, { db, groupId, billId, billingDate, dueDate, hour: input.reminderHour ?? 9, reminderMode, telegram: telegram.data(), slack: slack.data(), now: now() });
      return { id: ref.id, duplicate: false };
    });
  }

  async function detail(gid, bid) {
    const ref = billRef(gid, bid);
    const [group, bill, allocations, events] = await Promise.all([groupRef(gid).get(), ref.get(), ref.collection("allocations").get(), ref.collection("events").get()]);
    checkGroup(group);
    if (!bill.exists) reject(404, "BILL_NOT_FOUND");
    const items = readDocs(allocations);
    return { id: bid, ...bill.data(), allocations: items, events: readDocs(events), summary: { ...billSummary(items), ...(bill.data().state === "voided" ? { outstanding: 0 } : {}) } };
  }

  async function payment({ groupId, billId, memberId, actorUid, requestId, action, note = "", transferReference = "" }) {
    if (!validId(memberId) || !validId(requestId) || !["confirm", "reverse"].includes(action) ||
        typeof note !== "string" || note.length > 500 || typeof transferReference !== "string" || transferReference.length > 100) reject(400, "INVALID_PAYMENT");
    if (action === "reverse" && !note.trim()) reject(400, "CORRECTION_REASON_REQUIRED");
    const ref = billRef(groupId, billId);
    const allocationRef = ref.collection("allocations").doc(memberId);
    const eventRef = ref.collection("events").doc(`payment_${requestId}`);
    return db.runTransaction(async (tx) => {
      const [group, bill, allocation, priorEvent] = await tx.getAll(groupRef(groupId), ref, allocationRef, eventRef);
      checkGroup(group);
      if (!bill.exists || !allocation.exists) reject(404, "ALLOCATION_NOT_FOUND");
      if (priorEvent.exists) {
        if (priorEvent.data().memberId !== memberId || priorEvent.data().type !== action) reject(409, "REQUEST_ID_REUSED");
        return { duplicate: true };
      }
      if (bill.data().state === "voided") reject(409, "BILL_VOIDED");
      const data = allocation.data();
      if (data.state !== (action === "confirm" ? "unpaid" : "paid")) reject(409, "PAYMENT_STATE_CHANGED");
      const allocations = await tx.get(ref.collection("allocations"));
      const nextState = action === "confirm" ? "paid" : "unpaid";
      const stillUnpaid = allocations.docs.some((doc) => doc.id === memberId ? nextState === "unpaid" : doc.data().state === "unpaid");
      const timestamp = FieldValue.serverTimestamp();
      tx.update(allocationRef, { state: nextState, paidAt: action === "confirm" ? timestamp : null, paymentEventId: eventRef.id });
      tx.update(ref, { state: stillUnpaid ? "open" : "closed", updatedAt: timestamp });
      tx.set(eventRef, { type: action, memberId, actorUid, amountVnd: data.amountVnd, method: "manual_bank_transfer", note: note.trim(), transferReference: transferReference.trim(), createdAt: timestamp });
      return { duplicate: false };
    });
  }

  async function list(gid) {
    checkGroup(await groupRef(gid).get());
    const bills = await groupRef(gid).collection("bills").get();
    return Promise.all(bills.docs.sort((a, b) => b.data().billingDate.localeCompare(a.data().billingDate)).map((doc) => detail(gid, doc.id)));
  }

  async function members(gid) {
    checkGroup(await groupRef(gid).get());
    return (await db.collection("members").where("groupId", "==", gid).get()).docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name,
      inactive: !!doc.data().inactive,
      autoCoverWhenPayer: doc.data().autoCoverWhenPayer !== false,
    }));
  }

  async function saveMember(gid, id, input, actorUid) {
    if (!isValidGroupId(gid) || !validId(id) || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 60 ||
        (input.inactive !== undefined && typeof input.inactive !== "boolean") ||
        (input.autoCoverWhenPayer !== undefined && typeof input.autoCoverWhenPayer !== "boolean")) reject(400, "INVALID_MEMBER");
    const ref = db.collection("members").doc(id);
    return db.runTransaction(async (tx) => {
      const [group, member] = await tx.getAll(groupRef(gid), ref);
      checkGroup(group);
      if (member.exists && groupIdOf(member.data()) !== gid) reject(409, "MEMBER_ID_EXISTS");
      tx.set(ref, {
        groupId: gid,
        name: input.name.trim(),
        inactive: input.inactive ?? false,
        autoCoverWhenPayer: input.autoCoverWhenPayer ?? true,
        updatedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { id };
    });
  }

  async function remind(gid, bid, actorUid, requestId, preview = false) {
    if (!preview && !validId(requestId)) reject(400, "REQUEST_ID_REQUIRED");
    const ref = billRef(gid, bid);
    return db.runTransaction(async (tx) => {
      const [group, bill, telegram, slack] = await tx.getAll(groupRef(gid), ref,
        groupRef(gid).collection("settings").doc("telegram"), groupRef(gid).collection("settings").doc("slack"));
      checkGroup(group);
      if (!bill.exists || bill.data().state !== "open") reject(409, "BILL_NOT_OPEN");
      const allocations = (await tx.get(ref.collection("allocations"))).docs.map((doc) => doc.data());
      const priorDebtByMember = new Map();
      try {
        const openBillsSnap = await db.collection(`groups/${gid}/bills`).where("state", "==", "open").get();
        for (const bDoc of openBillsSnap.docs) {
          if (bDoc.id === bid) continue;
          const b = bDoc.data();
          const periodKey = b.periodKey || (b.billingDate ? b.billingDate.slice(0, 7) : "");
          const aSnap = await bDoc.ref.collection("allocations").get();
          for (const aDoc of aSnap.docs) {
            const a = aDoc.data();
            if (a.state === "unpaid") {
              const current = priorDebtByMember.get(a.memberId) || { total: 0, items: [] };
              current.total += a.amountVnd;
              current.items.push({ period: periodKey, amount: a.amountVnd });
              priorDebtByMember.set(a.memberId, current);
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
      const text = reminderText(bill.data(), allocations, priorDebtByMember);
      if (preview) return { text };
      const eventRef = ref.collection("events").doc(`reminder_${requestId}`);
      if ((await tx.get(eventRef)).exists) return { queued: true, duplicate: true };
      if (bill.data().lastReminderRequestedAt && now().getTime() - bill.data().lastReminderRequestedAt < 60000) reject(429, "REMINDER_COOLDOWN");
      const targets = [["telegram", telegram.data()], ["slack", slack.data()]].filter(([, settings]) => settings?.enabled);
      if (!targets.length) reject(409, "NO_REMINDER_CHANNEL_CONNECTED");
      for (const [provider, settings] of targets) tx.set(db.doc(`billNotificationJobs/${gid}_${bid}_${provider}_manual_${requestId}`), {
        groupId: gid, billId: bid, provider, event: "manual", destinationVersion: provider === "telegram" ? settings.version || 0 : settings.channelId,
        state: "pending", attempts: 0, leaseUntil: 0, dueAt: now().getTime(),
      });
      tx.update(ref, { lastReminderRequestedAt: now().getTime() });
      tx.set(eventRef, { type: "reminder_requested", actorUid, amountVnd: billSummary(allocations).outstanding, createdAt: FieldValue.serverTimestamp() });
      return { queued: true };
    });
  }

  async function voidBill(gid, bid, actorUid, reason) {
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) reject(400, "VOID_REASON_REQUIRED");
    const ref = billRef(gid, bid);
    return db.runTransaction(async (tx) => {
      const [group, bill] = await tx.getAll(groupRef(gid), ref);
      checkGroup(group);
      if (!bill.exists) reject(404, "BILL_NOT_FOUND");
      if (bill.data().state === "voided") return { duplicate: true };
      const allocations = await tx.get(ref.collection("allocations"));
      if (allocations.docs.some((allocation) => allocation.data().state === "paid")) reject(409, "PAYMENTS_REQUIRE_CORRECTION");
      tx.update(ref, { state: "voided", voidReason: reason.trim(), updatedAt: FieldValue.serverTimestamp() });
      tx.set(ref.collection("events").doc("voided"), { type: "voided", actorUid, note: reason.trim(), amountVnd: bill.data().amountVnd, createdAt: FieldValue.serverTimestamp() });
      return { duplicate: false };
    });
  }

  async function settleTier1Payout({ groupId, billId, actorUid, reference = "", note = "" }) {
    const ref = billRef(groupId, billId);
    return db.runTransaction(async (tx) => {
      const [group, bill] = await tx.getAll(groupRef(groupId), ref);
      checkGroup(group);
      if (!bill.exists) reject(404, "BILL_NOT_FOUND");
      const data = bill.data();
      const recon = data.reconciliation || {};
      if (recon.tier1Payout?.status === "SETTLED") return { ok: true, alreadySettled: true };
      const timestamp = FieldValue.serverTimestamp();
      const updatedRecon = {
        ...recon,
        tier1Payout: {
          ...(recon.tier1Payout || {}),
          status: "SETTLED",
          settledAt: timestamp,
          settledByUid: actorUid,
          transactionReference: reference,
          note,
        },
      };
      tx.update(ref, { reconciliation: updatedRecon });
      tx.set(ref.collection("events").doc(`settle_tier1_${Date.now()}`), {
        type: "tier1_settled", actorUid, note: `${reference ? `Ref: ${reference}. ` : ""}${note}`.trim(), amountVnd: recon.tier1Payout?.amountVnd || 0, createdAt: timestamp,
      });
      return { ok: true };
    });
  }

  async function settleTier2Payout({ groupId, billId, actorUid, reference = "", note = "" }) {
    const ref = billRef(groupId, billId);
    return db.runTransaction(async (tx) => {
      const [group, bill] = await tx.getAll(groupRef(groupId), ref);
      checkGroup(group);
      if (!bill.exists) reject(404, "BILL_NOT_FOUND");
      const data = bill.data();
      const recon = data.reconciliation || {};
      if (recon.tier2Payout?.status === "SETTLED") return { ok: true, alreadySettled: true };
      const timestamp = FieldValue.serverTimestamp();
      const updatedRecon = {
        ...recon,
        tier2Payout: {
          ...(recon.tier2Payout || {}),
          status: "SETTLED",
          settledAt: timestamp,
          settledByUid: actorUid,
          transactionReference: reference,
          note,
        },
      };
      tx.update(ref, { reconciliation: updatedRecon });
      tx.set(ref.collection("events").doc(`settle_tier2_${Date.now()}`), {
        type: "tier2_settled", actorUid, note: `${reference ? `Ref: ${reference}. ` : ""}${note}`.trim(), amountVnd: recon.tier2Payout?.amountVnd || 0, createdAt: timestamp,
      });
      return { ok: true };
    });
  }

  return { create, detail, payment, list, members, saveMember, remind, voidBill, settleTier1Payout, settleTier2Payout };
}

module.exports = { splitBill, billSummary, createBillService, requireDate, validId, reject };
