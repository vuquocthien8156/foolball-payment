const { groupKindOf, groupIdOf, isValidGroupId } = require("./groups");
const { createBillService, splitBill, validId, reject } = require("./bills");
const { queueCatchupSummary, ensureBillNotifications } = require("./billNotifications");

function requireMonth(month) {
  if (typeof month !== "string" || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) reject(400, "INVALID_MONTH");
  return month;
}
function billingDateFor(month, day) {
  requireMonth(month);
  if (!Number.isInteger(day) || day < 1 || day > 31) reject(400, "INVALID_BILLING_DAY");
  const [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}
function nextMonth(month) {
  requireMonth(month);
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}
function addDays(date, days) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}

function createSubscriptionService({ db, FieldValue }) {
  const refFor = (gid, sid) => {
    if (!isValidGroupId(gid) || !validId(sid) || sid.length > 100) reject(400, "INVALID_SUBSCRIPTION_ID");
    return db.doc(`groups/${gid}/subscriptions/${sid}`);
  };
  const checkGroup = (snap) => {
    if (!snap.exists || groupKindOf(snap.data()) !== "shared_bills" || snap.data().status !== "active") reject(403, "BILL_GROUP_REQUIRED");
  };
  async function save(gid, sid, input, actorUid) {
    const ref = refFor(gid, sid);
    requireMonth(input.startMonth);
    billingDateFor(input.startMonth, input.billingDay);
    const dueOffsetDays = input.dueOffsetDays ?? 0;
    if (!Number.isInteger(dueOffsetDays) || dueOffsetDays < 0 || dueOffsetDays > 30 ||
        !Number.isInteger(input.reminderHour) || input.reminderHour < 0 || input.reminderHour > 23 ||
        typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 100 ||
        !Array.isArray(input.participantIds) || input.participantIds.length < 1 || input.participantIds.length > 50 ||
        !input.participantIds.every(validId)) reject(400, "INVALID_SUBSCRIPTION");
    const result = await db.runTransaction(async (tx) => {
      const [group, existing, ...members] = await tx.getAll(db.doc(`groups/${gid}`), ref,
        ...input.participantIds.map((id) => db.doc(`members/${id}`)));
      checkGroup(group);
      if (members.some((m) => !m.exists || groupIdOf(m.data()) !== gid || m.data().inactive)) reject(400, "INVALID_PARTICIPANTS");
      splitBill({ amountVnd: input.amountVnd, participants: members.map((m) => ({ id: m.id, name: m.data().name })), providerPayerMemberId: input.providerPayerMemberId });
      const prior = existing.data();
      const reminderMode = ["default", "bill_only", "full", "none"].includes(input.reminderMode)
        ? input.reminderMode
        : (prior?.reminderMode || "default");
      const settlementMode = ["full_collection", "net_offset"].includes(input.settlementMode)
        ? input.settlementMode
        : (prior?.settlementMode || "full_collection");
      tx.set(ref, { title: input.title.trim(), amountVnd: input.amountVnd, participantIds: input.participantIds,
        providerPayerMemberId: input.providerPayerMemberId, billingDay: input.billingDay, startMonth: input.startMonth,
        dueOffsetDays, reminderHour: input.reminderHour, timeZone: "Asia/Ho_Chi_Minh",
        reminderMode, settlementMode,
        revision: (prior?.revision || 0) + 1, enabled: prior ? prior.enabled : true,
        nextPeriod: prior?.nextPeriod || input.startMonth, createdBy: prior?.createdBy || actorUid,
        createdAt: prior?.createdAt || FieldValue.serverTimestamp(), updatedBy: actorUid, updatedAt: FieldValue.serverTimestamp(), lastError: null });
      return { id: sid };
    });
    return result;
  }
  async function setEnabled(gid, sid, enabled, startMonth, actorUid) {
    const ref = refFor(gid, sid);
    if (enabled) requireMonth(startMonth);
    return db.runTransaction(async (tx) => {
      const [group, snap] = await tx.getAll(db.doc(`groups/${gid}`), ref);
      checkGroup(group);
      if (!snap.exists) reject(404, "SUBSCRIPTION_NOT_FOUND");
      if (enabled && startMonth < snap.data().nextPeriod) reject(400, "RESUME_MONTH_ALREADY_BILLED");
      tx.update(ref, { enabled, ...(enabled ? { nextPeriod: startMonth } : {}), revision: snap.data().revision + 1, updatedBy: actorUid, updatedAt: FieldValue.serverTimestamp() });
      return { id: sid };
    });
  }
  async function list(gid) {
    checkGroup(await db.doc(`groups/${gid}`).get());
    return (await db.collection(`groups/${gid}/subscriptions`).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
  return {
    save,
    list,
    pause: (gid, sid, actorUid) => setEnabled(gid, sid, false, null, actorUid),
    resume: (gid, sid, month, actorUid) => setEnabled(gid, sid, true, month, actorUid),
    runNow: (gid) => runScheduledBillsForGroup({ db, FieldValue, groupId: gid, forceHour: true }),
  };
}

async function runScheduledBillsForGroup({ db, FieldValue, groupId, now = new Date(), forceHour = false }) {
  const local = new Date(now.getTime() + 7 * 3600000);
  const today = local.toISOString().slice(0, 10);
  const service = createBillService({ db, FieldValue, now: () => now });
  const subscriptions = await db.collection(`groups/${groupId}/subscriptions`).where("enabled", "==", true).get();
  const results = [];
  for (const subscription of subscriptions.docs) {
    for (let count = 0; count < 12; count++) {
      const current = await subscription.ref.get();
      const data = current.data();
      if (!data?.enabled) break;
      try {
        const billingDate = billingDateFor(data.nextPeriod, data.billingDay);
        if (billingDate > today || (!forceHour && billingDate === today && local.getUTCHours() < data.reminderHour)) break;
        await service.create({
          groupId,
          billId: `${subscription.id}_${data.nextPeriod}`,
          input: { ...data, billingDate, dueDate: addDays(billingDate, data.dueOffsetDays ?? 0) },
          actorUid: "monthly_job",
          occurrence: { subscriptionId: subscription.id, periodKey: data.nextPeriod, revision: data.revision, nextPeriod: nextMonth(data.nextPeriod) },
        });
        results.push({ groupId, subscriptionId: subscription.id, period: data.nextPeriod, ok: true });
      } catch (error) {
        if (error.message === "SUBSCRIPTION_CHANGED") continue;
        await subscription.ref.update({ lastError: error.status ? error.message : "GENERATION_FAILED", lastErrorAt: FieldValue.serverTimestamp() });
        results.push({ groupId, subscriptionId: subscription.id, ok: false });
        break;
      }
    }
  }
  await queueCatchupSummary({ db, groupId, now });
  await ensureBillNotifications({ db, groupId, now });
  return results;
}

async function runScheduledBills({ db, FieldValue, now = new Date() }) {
  const groups = await db.collection("groups").where("status", "==", "active").get();
  const results = [];
  for (const group of groups.docs) {
    if (groupKindOf(group.data()) !== "shared_bills") continue;
    const groupResults = await runScheduledBillsForGroup({ db, FieldValue, groupId: group.id, now, forceHour: false });
    results.push(...groupResults);
  }
  return results;
}

module.exports = { requireMonth, billingDateFor, nextMonth, addDays, createSubscriptionService, runScheduledBills, runScheduledBillsForGroup };
