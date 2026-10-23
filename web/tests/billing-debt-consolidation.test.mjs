import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createFakeFirestore } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const { createBillService, splitBill } = require("../../server/lib/bills.js");
const { deliverBillNotifications, reminderText } = require("../../server/lib/billNotifications.js");

test("splitBill respects autoCoverPayer flag", () => {
  const participants = [{ id: "payer", name: "Payer" }, { id: "member2", name: "Member 2" }];
  const covered = splitBill({ amountVnd: 100000, participants, providerPayerMemberId: "payer", autoCoverPayer: true });
  assert.equal(covered.find((a) => a.memberId === "payer").state, "covered_by_payer");
  assert.equal(covered.find((a) => a.memberId === "member2").state, "unpaid");

  const uncovered = splitBill({ amountVnd: 100000, participants, providerPayerMemberId: "payer", autoCoverPayer: false });
  assert.equal(uncovered.find((a) => a.memberId === "payer").state, "unpaid");
  assert.equal(uncovered.find((a) => a.memberId === "member2").state, "unpaid");
});

test("reminderText includes prior unpaid debt when provided", () => {
  const bill = { title: "Netflix", billingDate: "2026-11-01", dueDate: "2026-11-05" };
  const allocations = [
    { memberId: "b", name: "Friend B", amountVnd: 52000, state: "unpaid" },
    { memberId: "c", name: "Friend C", amountVnd: 52000, state: "unpaid" },
  ];
  const priorDebt = new Map([["b", 52000]]);
  const text = reminderText(bill, allocations, priorDebt);

  assert.ok(text.includes("Friend B: 104.000 VND (52.000 VND kỳ này + 52.000 VND nợ cũ)"));
  assert.ok(text.includes("Friend C: 52.000 VND"));
  assert.ok(text.includes("Còn phải thu: 156.000 VND"));
});

test("notificationContent aggregates prior unpaid debt across multiple open bills", async () => {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    "groups/netflix/settings/telegram": { enabled: true, version: 1, chatId: "-1001", events: ["opened", "due"] },
    "members/a": { name: "Owner", groupId: "netflix", autoCoverWhenPayer: true },
    "members/b": { name: "Friend", groupId: "netflix", autoCoverWhenPayer: true },
  });
  const now = new Date("2026-11-01T03:00:00Z");
  const service = createBillService({ ...fake, now: () => now });

  // Bill 1: October (open, unpaid by Friend)
  await service.create({
    groupId: "netflix",
    billId: "oct",
    actorUid: "owner",
    input: { title: "Netflix Oct", amountVnd: 100000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDate: "2026-10-01", dueDate: "2026-10-05" },
  });

  // Bill 2: November (open)
  await service.create({
    groupId: "netflix",
    billId: "nov",
    actorUid: "owner",
    input: { title: "Netflix Nov", amountVnd: 100000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDate: "2026-11-01", dueDate: "2026-11-05" },
  });

  const preview = await service.remind("netflix", "nov", "owner", null, true);
  // Friend owes 50,000 from Nov + 50,000 from Oct = 100,000 VND
  assert.ok(preview.text.includes("Friend: 100.000 VND (50.000 VND kỳ này + 50.000 VND nợ cũ)"));
  assert.ok(preview.text.includes("Còn phải thu: 100.000 VND"));
});
