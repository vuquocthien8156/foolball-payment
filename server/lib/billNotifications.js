const { randomUUID } = require("node:crypto");
const localDate = (date) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const atHour = (date, hour) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`);
const plusDays = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

function enqueueBillNotifications(tx, { db, groupId, billId, billingDate, dueDate, hour = 9, telegram, slack, now, existingIds = new Set(), reminderMode = "default" }) {
  if (reminderMode === "none") return;
  const today = localDate(now);
  const schedule = [["opened", billingDate, now.getTime()], ["due", dueDate, atHour(dueDate, hour)], ["overdue", plusDays(dueDate, 3), atHour(plusDays(dueDate, 3), hour)]];
  for (const [provider, settings] of [["telegram", telegram], ["slack", slack]]) {
    if (!settings?.enabled) continue;
    const version = provider === "telegram" ? settings.version || 0 : settings.channelId;
    for (const [event, date, dueAt] of schedule) {
      if (date < today) continue;
      if (provider === "telegram") {
        if (reminderMode === "bill_only" && event !== "opened") continue;
        if (reminderMode === "full" && !["opened", "due", "overdue"].includes(event)) continue;
        if ((reminderMode === "default" || !reminderMode) && !(settings.events || []).includes(event)) continue;
      }
      const id = `${groupId}_${billId}_${provider}_${event}_${version}`;
      if (existingIds.has(id)) continue;
      tx.set(db.doc(`billNotificationJobs/${id}`), { groupId, billId, provider, event, scheduledDate: date, dueAt,
        destinationVersion: version, state: "pending", attempts: 0, leaseUntil: 0 });
    }
  }
}

async function ensureBillNotifications({ db, groupId, now }) {
  const bills = await db.collection(`groups/${groupId}/bills`).where("state", "==", "open").get();
  for (const bill of bills.docs) await db.runTransaction(async (tx) => {
    const [current, telegram, slack] = await tx.getAll(bill.ref, db.doc(`groups/${groupId}/settings/telegram`), db.doc(`groups/${groupId}/settings/slack`));
    if (!current.exists || current.data().state !== "open") return;
    const jobs = await tx.get(db.collection("billNotificationJobs").where("groupId", "==", groupId).where("billId", "==", bill.id));
    const data = current.data();
    enqueueBillNotifications(tx, { db, groupId, billId: bill.id, billingDate: data.billingDate, dueDate: data.dueDate,
      hour: data.reminderHour ?? 9, reminderMode: data.reminderMode || "default", telegram: telegram.data(), slack: slack.data(), now, existingIds: new Set(jobs.docs.map((job) => job.id)) });
  });
}

function formatPeriodLabel(str) {
  if (!str) return "";
  const match = String(str).match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[2]}/${match[1]}`;
  return String(str);
}

function formatDateLabel(str) {
  if (!str) return "";
  const match = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return String(str);
}

function reminderText(bill, allocations, priorDebtByMember = new Map()) {
  const unpaid = allocations.filter((allocation) => allocation.state === "unpaid");
  let grandTotal = 0;
  const currentPeriod = formatPeriodLabel(bill.periodKey || bill.billingDate?.slice(0, 7));
  const lines = unpaid.map((allocation) => {
    const current = allocation.amountVnd;
    const debtEntry = priorDebtByMember.get(allocation.memberId);
    const prior = typeof debtEntry === "number" ? debtEntry : (debtEntry?.total || 0);
    const items = typeof debtEntry === "object" && Array.isArray(debtEntry?.items) ? debtEntry.items : [];
    const total = current + prior;
    grandTotal += total;

    if (prior > 0) {
      const header = `• ${allocation.name.slice(0, 40)}: ${total.toLocaleString("vi-VN")} VND`;
      const currentLine = `  ↳ Kỳ này (${currentPeriod || "kỳ hiện tại"}): ${current.toLocaleString("vi-VN")} VND`;
      let priorLines = "";
      if (items.length > 0) {
        priorLines = items.map((it) => `  ↳ Nợ cũ tháng ${formatPeriodLabel(it.period)}: ${it.amount.toLocaleString("vi-VN")} VND`).join("\n");
      } else {
        priorLines = `  ↳ Nợ cũ các kỳ trước: ${prior.toLocaleString("vi-VN")} VND`;
      }
      return `${header}\n${currentLine}\n${priorLines}`;
    }
    return `• ${allocation.name.slice(0, 40)}: ${current.toLocaleString("vi-VN")} VND`;
  });

  const billingPeriodStr = currentPeriod ? ` — Tháng ${currentPeriod}` : "";
  const dueDateStr = formatDateLabel(bill.dueDate) || bill.dueDate;
  const subsidyStr = bill.subsidy?.amountVnd
    ? `\n🎁 Trợ giá: ${bill.subsidy.amountVnd.toLocaleString("vi-VN")} VND${bill.subsidy.sponsorName ? ` (${bill.subsidy.sponsorName})` : ""}`
    : "";

  return `📋 ${bill.title}${billingPeriodStr}\n⏰ Hạn thanh toán: ${dueDateStr}${subsidyStr}\n─────────────────────────\nChi tiết thanh toán:\n${lines.join("\n")}\n─────────────────────────\n💰 Còn phải thu: ${grandTotal.toLocaleString("vi-VN")} VND`;
}


async function queueCatchupSummary({ db, groupId, now }) {
  const bills = await db.collection(`groups/${groupId}/bills`).where("catchupPending", "==", true).limit(50).get();
  if (bills.empty) return;
  await db.runTransaction(async (tx) => {
    const [telegram, slack, ...currentBills] = await tx.getAll(db.doc(`groups/${groupId}/settings/telegram`), db.doc(`groups/${groupId}/settings/slack`), ...bills.docs.map((doc) => doc.ref));
    const targets = [["telegram", telegram.data()], ["slack", slack.data()]].filter(([provider, data]) => data?.enabled && (provider !== "telegram" || data.events?.includes("opened")));
    if (!targets.length) return;
    const jobs = targets.map(([provider, data]) => ({ provider, data, ref: db.doc(`billNotificationJobs/${groupId}_catchup_${localDate(now)}_${provider}_${provider === "telegram" ? data.version || 0 : data.channelId}`) }));
    const existing = await tx.getAll(...jobs.map((job) => job.ref));
    const billIds = currentBills.filter((bill) => bill.exists && bill.data().catchupPending).map((bill) => bill.id);
    jobs.forEach((job, index) => {
      const prior = existing[index].data();
      if (prior && prior.state !== "pending") return;
      tx.set(job.ref, { ...(prior || {}), groupId, billIds: [...new Set([...(prior?.billIds || []), ...billIds])], provider: job.provider,
        event: "catchup", destinationVersion: job.provider === "telegram" ? job.data.version || 0 : job.data.channelId,
        state: "pending", attempts: prior?.attempts || 0, leaseUntil: prior?.leaseUntil || 0, dueAt: now.getTime() });
    });
    currentBills.forEach((bill) => { if (bill.exists && bill.data().catchupPending) tx.update(bill.ref, { catchupPending: false }); });
  });
}

async function notificationContent(db, data) {
  const ids = data.billIds || [data.billId];
  const bills = await Promise.all(ids.map(async (id) => {
    const ref = db.doc(`groups/${data.groupId}/bills/${id}`);
    const [bill, allocations] = await Promise.all([ref.get(), ref.collection("allocations").get()]);
    if (!bill.exists || bill.data().state !== "open") return null;
    if (bill.data().subscriptionId) {
      const subscription = await db.doc(`groups/${data.groupId}/subscriptions/${bill.data().subscriptionId}`).get();
      if (!subscription.data()?.enabled) return null;
    }
    const unpaid = allocations.docs.map((doc) => doc.data()).filter((allocation) => allocation.state === "unpaid");
    return unpaid.length ? { id, bill: bill.data(), allocations: unpaid } : null;
  }));
  const open = bills.filter(Boolean);
  if (!open.length) return null;
  if (data.event !== "catchup") {
    const targetBill = open[0].bill;
    const targetBillId = open[0].id;
    const priorDebtByMember = new Map();
    try {
      const openBillsSnap = await db.collection(`groups/${data.groupId}/bills`).where("state", "==", "open").get();
      for (const bDoc of openBillsSnap.docs) {
        if (bDoc.id === targetBillId) continue;
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
      // Keep running with empty prior debt if query fails
    }
    return reminderText(targetBill, open[0].allocations, priorDebtByMember);
  }
  const total = open.reduce((sum, item) => sum + item.allocations.reduce((amount, allocation) => amount + allocation.amountVnd, 0), 0);
  return `Đã khôi phục lịch sử thu tiền\nĐã tạo ${open.length} kỳ thu còn thiếu.\nCòn phải thu: ${total.toLocaleString("vi-VN")} VND\nMở ứng dụng để kiểm tra từng tháng. Các tin nhắc cũ được gộp vào thông báo này.`;
}

async function migrateDestination(db, groupId, current, nextChatId) {
  if (typeof nextChatId !== "string" || !/^-\d+$/.test(nextChatId)) return false;
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`groups/${groupId}/settings/telegram`);
    const oldClaim = db.doc(`telegramDestinations/${current.chatId}`);
    const nextClaim = db.doc(`telegramDestinations/${nextChatId}`);
    const [settings, old, next] = await tx.getAll(ref, oldClaim, nextClaim);
    if (settings.data()?.chatId !== current.chatId || settings.data()?.version !== current.version) return false;
    if (next.exists && next.data().groupId !== groupId) return false;
    if (old.data()?.groupId === groupId) tx.delete(oldClaim);
    tx.set(nextClaim, { groupId });
    tx.update(ref, { chatId: nextChatId, lastError: null });
    return true;
  });
}

async function deliverBillNotifications({ db, FieldValue, telegram, slack, now = new Date(), muted = false }) {
  if (muted) return { sent: 0, muted: true };
  const jobs = await db.collection("billNotificationJobs").where("state", "==", "pending").where("dueAt", "<=", now.getTime()).limit(50).get();
  let sent = 0;
  const sentChats = new Set();
  for (const job of jobs.docs) {
    const leaseId = randomUUID();
    const data = await db.runTransaction(async (tx) => {
      const current = (await tx.get(job.ref)).data();
      if (!current || current.state !== "pending" || current.dueAt > now.getTime() || current.leaseUntil > now.getTime()) return null;
      tx.update(job.ref, { leaseId, leaseUntil: now.getTime() + 60000 });
      return current;
    });
    if (!data) continue;
    const finish = async (values) => db.runTransaction(async (tx) => {
      const current = (await tx.get(job.ref)).data();
      if (current?.leaseId === leaseId) tx.update(job.ref, { ...values, leaseUntil: 0 });
    });
    try {
      const [group, target] = await Promise.all([
        db.doc(`groups/${data.groupId}`).get(),
        db.doc(`groups/${data.groupId}/settings/${data.provider}`).get(),
      ]);
      const settings = target.data();
      const version = data.provider === "telegram" ? settings?.version || 0 : settings?.channelId;
      if (!group.exists || group.data().status !== "active" || !settings?.enabled || version !== data.destinationVersion ||
          (data.provider === "telegram" && data.event !== "manual" && !(settings.events || []).includes(data.event === "catchup" ? "opened" : data.event))) {
        await finish({ state: "cancelled" }); continue;
      }
      const text = await notificationContent(db, data);
      if (!text) { await finish({ state: "cancelled" }); continue; }
      let result;
      if (data.provider === "telegram") {
        const budget = db.doc("notificationState/telegram");
        const allowed = await db.runTransaction(async (tx) => {
          const previous = (await tx.get(budget)).data();
          if (previous?.availableAt > now.getTime() || sentChats.has(settings.chatId)) return false;
          tx.set(budget, { availableAt: now.getTime() + 1000 }); return true;
        });
        if (!allowed) { await finish({ dueAt: now.getTime() + 60000 }); continue; }
        sentChats.add(settings.chatId);
        result = await telegram.send({ chatId: settings.chatId, topicId: settings.topicId, text });
      } else if (slack) {
        result = await slack.postToSlackDetailed({ text }, { channelId: settings.channelId });
      } else result = { ok: false, error: "SLACK_NOT_CONFIGURED", retryable: false };
      if (data.provider === "telegram" && result.migrateToChatId && await migrateDestination(db, data.groupId, settings, result.migrateToChatId)) {
        await finish({ dueAt: now.getTime() + 60000, lastError: null }); continue;
      }
      if (result.ok) { await finish({ state: "sent", sentAt: FieldValue.serverTimestamp(), messageId: result.messageId || null }); sent++; }
      else {
        const attempts = data.attempts + 1;
        await finish({ state: result.retryable !== false && attempts < 5 ? "pending" : "failed", attempts,
          dueAt: now.getTime() + Math.max(result.retryAfter || 0, 60 * 2 ** attempts) * 1000, lastError: result.error || "DELIVERY_FAILED" });
        if (data.provider === "telegram" && (result.retryable === false || attempts >= 5)) await db.runTransaction(async (tx) => {
          const current = (await tx.get(target.ref)).data();
          if (current?.version === settings.version && current?.chatId === settings.chatId) tx.set(target.ref, { lastError: result.error, ...(result.retryable === false ? { enabled: false } : {}) }, { merge: true });
        });
      }
    } catch {
      await finish({ state: data.attempts >= 4 ? "failed" : "pending", attempts: data.attempts + 1, dueAt: now.getTime() + 300000, lastError: "DELIVERY_FAILED" });
    }
  }
  return { sent };
}

module.exports = { enqueueBillNotifications, ensureBillNotifications, reminderText, deliverBillNotifications, queueCatchupSummary, localDate, atHour };
