import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createFakeFirestore } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const { billingDateFor, nextMonth, createSubscriptionService, runScheduledBills } = require("../../server/lib/scheduledBills.js");
const { deliverBillNotifications } = require("../../server/lib/billNotifications.js");

test("calendar clamps short months and restores original day across year boundaries", () => {
  assert.equal(billingDateFor("2027-02", 31), "2027-02-28");
  assert.equal(billingDateFor("2028-02", 31), "2028-02-29");
  assert.equal(billingDateFor("2027-03", 31), "2027-03-31");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.throws(() => billingDateFor("2026-13", 31));
});

test("recurring creation retries once, preserves old amount, and pause/resume requires a month", async () => {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    "members/a": { name: "Owner", groupId: "netflix" }, "members/b": { name: "Friend", groupId: "netflix" },
  });
  const service = createSubscriptionService(fake);
  const input = { title: "Netflix", amountVnd: 260000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDay: 31, startMonth: "2026-10", dueOffsetDays: 3, reminderHour: 9 };
  await service.save("netflix", "netflix-monthly", input, "manager");
  const firstRun = await runScheduledBills({ ...fake, now: new Date("2026-10-31T03:00:00Z") });
  assert.equal(firstRun.length, 1);
  assert.equal(fake.records.get("groups/netflix/subscriptions/netflix-monthly").nextPeriod, "2026-11");
  assert.equal(fake.records.get("groups/netflix/bills/netflix-monthly_2026-10").source, "subscription");
  await runScheduledBills({ ...fake, now: new Date("2026-10-31T04:00:00Z") });
  assert.equal([...fake.records.keys()].filter((key) => /^groups\/netflix\/bills\/[^/]+$/.test(key)).length, 1);
  assert.equal(fake.records.get("groups/netflix/bills/netflix-monthly_2026-10").amountVnd, 260000);
  await service.save("netflix", "netflix-monthly", { ...input, amountVnd: 300000 }, "manager");
  assert.equal(fake.records.get("groups/netflix/bills/netflix-monthly_2026-10").amountVnd, 260000);
  await service.pause("netflix", "netflix-monthly", "manager");
  await runScheduledBills({ ...fake, now: new Date("2026-11-30T03:00:00Z") });
  assert.equal(fake.records.has("groups/netflix/bills/netflix-monthly_2026-11"), false);
  await assert.rejects(service.resume("netflix", "netflix-monthly", undefined, "manager"));
  await service.resume("netflix", "netflix-monthly", "2026-12", "manager");
  await runScheduledBills({ ...fake, now: new Date("2026-12-31T03:00:00Z") });
  assert.equal(fake.records.get("groups/netflix/bills/netflix-monthly_2026-12").amountVnd, 300000);
});

test("outage catch-up creates missed periods and queues one summary instead of old reminders", async () => {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    "groups/netflix/settings/telegram": { enabled: true, version: 1, chatId: "-1001", events: ["opened", "due", "overdue"] },
    "members/a": { name: "Owner", groupId: "netflix" }, "members/b": { name: "Friend", groupId: "netflix" },
  });
  await createSubscriptionService(fake).save("netflix", "monthly", { title: "Netflix", amountVnd: 260000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDay: 1, startMonth: "2026-01", dueOffsetDays: 3, reminderHour: 9 }, "owner");
  await runScheduledBills({ ...fake, now: new Date("2026-04-20T03:00:00Z") });
  const bills = [...fake.records.keys()].filter((key) => /^groups\/netflix\/bills\/[^/]+$/.test(key));
  assert.equal(bills.length, 4);
  const jobs = [...fake.records].filter(([key]) => key.startsWith("billNotificationJobs/"));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0][1].event, "catchup");
  assert.equal(jobs[0][1].billIds.length, 4);
  const messages = [];
  await deliverBillNotifications({ ...fake, now: new Date("2026-04-20T03:00:00Z"), telegram: { send: async (input) => { messages.push(input.text); return { ok: true, messageId: 1 }; } } });
  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes("4 kỳ thu"));
});
