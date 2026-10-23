import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createFakeFirestore } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const { createBillService } = require("../../server/lib/bills.js");
const { deliverBillNotifications, ensureBillNotifications } = require("../../server/lib/billNotifications.js");

test("bill queues channel reminders and worker skips paid people and disabled channels", async () => {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    "groups/netflix/settings/telegram": { enabled: true, version: 1, chatId: "-1001", events: ["opened", "due", "overdue"] },
    "members/a": { name: "Owner", groupId: "netflix" }, "members/b": { name: "Friend", groupId: "netflix" },
  });
  const now = new Date("2026-11-01T03:00:00Z");
  const service = createBillService({ ...fake, now: () => now });
  await service.create({ groupId: "netflix", billId: "nov", actorUid: "owner", input: { title: "Netflix", amountVnd: 260000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDate: "2026-11-01", dueDate: "2026-11-05" } });
  const jobs = [...fake.records].filter(([key]) => key.startsWith("billNotificationJobs/"));
  assert.equal(jobs.length, 3);
  const preview = await service.remind("netflix", "nov", "owner", null, true);
  assert.ok(preview.text.includes("Friend"));
  assert.equal([...fake.records.keys()].filter((key) => key.startsWith("billNotificationJobs/")).length, 3);
  const sends = [];
  const telegram = { send: async (input) => { sends.push(input); return { ok: true, messageId: 1 }; } };
  await deliverBillNotifications({ ...fake, now, telegram });
  assert.equal(sends.length, 1);
  assert.ok(sends[0].text.includes("Friend"));
  assert.equal(sends[0].text.includes("Owner: 130"), false);
  await service.payment({ groupId: "netflix", billId: "nov", memberId: "b", actorUid: "owner", requestId: "paid", action: "confirm" });
  await deliverBillNotifications({ ...fake, now: new Date("2026-11-05T04:00:00Z"), telegram });
  assert.equal(sends.length, 1);
});

test("manual reminder retries are idempotent and cooldown prevents repeated clicks", async () => {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    "groups/netflix/settings/telegram": { enabled: true, version: 1, chatId: "-1001", events: [] },
    "members/a": { name: "Owner", groupId: "netflix" }, "members/b": { name: "Friend", groupId: "netflix" },
  });
  const service = createBillService(fake);
  await service.create({ groupId: "netflix", billId: "manual", actorUid: "owner", input: { title: "Netflix", amountVnd: 260000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDate: "2026-01-01", dueDate: "2026-01-05" } });
  await service.remind("netflix", "manual", "owner", "click-one");
  await service.remind("netflix", "manual", "owner", "click-one");
  await assert.rejects(service.remind("netflix", "manual", "owner", "click-two"), /REMINDER_COOLDOWN/);
  assert.equal([...fake.records.keys()].filter((key) => key.startsWith("billNotificationJobs/")).length, 1);
});

test("connecting a channel after bill creation schedules reminders without resetting sent jobs", async () => {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    "members/a": { name: "Owner", groupId: "netflix" }, "members/b": { name: "Friend", groupId: "netflix" },
  });
  const now = new Date("2026-11-01T03:00:00Z");
  const service = createBillService({ ...fake, now: () => now });
  await service.create({ groupId: "netflix", billId: "later", actorUid: "owner", input: { title: "Netflix", amountVnd: 260000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDate: "2026-11-01", dueDate: "2026-11-05" } });
  fake.records.set("groups/netflix/settings/telegram", { enabled: true, version: 1, chatId: "-1001", events: ["opened", "due", "overdue"] });
  await ensureBillNotifications({ db: fake.db, groupId: "netflix", now });
  let sends = 0;
  await deliverBillNotifications({ ...fake, now, telegram: { send: async () => { sends++; return { ok: true, messageId: 1 }; } } });
  await ensureBillNotifications({ db: fake.db, groupId: "netflix", now });
  await deliverBillNotifications({ ...fake, now: new Date(now.getTime() + 100000), telegram: { send: async () => { sends++; return { ok: true, messageId: 2 }; } } });
  assert.equal(sends, 1);
});

async function pendingReminder({ slack = false } = {}) {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    "groups/netflix/settings/telegram": { enabled: true, version: 1, chatId: "-1001", events: [] },
    "telegramDestinations/-1001": { groupId: "netflix" },
    ...(slack ? { "groups/netflix/settings/slack": { enabled: true, channelId: "C0123ABCD" } } : {}),
    "members/a": { name: "Owner", groupId: "netflix" }, "members/b": { name: "Friend", groupId: "netflix" },
  });
  const now = new Date("2026-11-01T03:00:00Z");
  const service = createBillService({ ...fake, now: () => now });
  await service.create({ groupId: "netflix", billId: "pending", actorUid: "owner", input: { title: "Netflix", amountVnd: 260000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDate: "2026-01-01", dueDate: "2026-01-05" } });
  await service.remind("netflix", "pending", "owner", "send-once");
  return { ...fake, now, jobPath: "billNotificationJobs/netflix_pending_telegram_manual_send-once" };
}

test("leased jobs wait; throttled delivery retries and stale destination versions are cancelled", async () => {
  const host = await pendingReminder();
  let sends = 0;
  const telegram = { send: async () => { sends++; return { ok: false, error: "RATE_LIMITED", retryable: true, retryAfter: 12 }; } };
  host.records.get(host.jobPath).leaseUntil = host.now.getTime() + 10000;
  await deliverBillNotifications({ ...host, telegram });
  assert.equal(sends, 0);
  host.records.get(host.jobPath).leaseUntil = 0;
  await deliverBillNotifications({ ...host, telegram });
  assert.equal(sends, 1);
  assert.equal(host.records.get(host.jobPath).attempts, 1);
  host.records.get("groups/netflix/settings/telegram").version = 2;
  await deliverBillNotifications({ ...host, now: new Date(host.now.getTime() + 300000), telegram });
  assert.equal(sends, 1);
  assert.equal(host.records.get(host.jobPath).state, "cancelled");
});

test("permanent Telegram failures do not block Slack and provider migrations preserve the group claim", async () => {
  const host = await pendingReminder({ slack: true });
  let slackSends = 0;
  await deliverBillNotifications({ ...host, telegram: { send: async () => ({ ok: false, error: "BOT_ACCESS_DENIED", retryable: false }) },
    slack: { postToSlackDetailed: async () => { slackSends++; return { ok: true }; } } });
  assert.equal(slackSends, 1);
  assert.equal(host.records.get(host.jobPath).state, "failed");
  assert.equal(host.records.get("groups/netflix/settings/telegram").enabled, false);
  const migrated = await pendingReminder();
  await deliverBillNotifications({ ...migrated, telegram: { send: async () => ({ ok: false, error: "CHAT_MIGRATED", retryable: false, migrateToChatId: "-1002" }) } });
  assert.equal(migrated.records.get("groups/netflix/settings/telegram").chatId, "-1002");
  assert.equal(migrated.records.has("telegramDestinations/-1001"), false);
  assert.equal(migrated.records.get("telegramDestinations/-1002").groupId, "netflix");
  assert.equal(migrated.records.get(migrated.jobPath).state, "pending");
});
