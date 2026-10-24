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

  assert.ok(text.includes("• Friend B: 104.000 VND"));
  assert.ok(text.includes("↳ Kỳ này (11/2026): 52.000 VND"));
  assert.ok(text.includes("↳ Nợ cũ các kỳ trước: 52.000 VND"));
  assert.ok(text.includes("• Friend C: 52.000 VND"));
  assert.ok(text.includes("💰 Còn phải thu: 156.000 VND"));
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
  // Friend owes 50,000 from Nov + 50,000 from Oct = 100,000 VND with detailed month
  assert.ok(preview.text.includes("• Friend: 100.000 VND"));
  assert.ok(preview.text.includes("↳ Kỳ này (11/2026): 50.000 VND"));
  assert.ok(preview.text.includes("↳ Nợ cũ tháng 10/2026: 50.000 VND"));
  assert.ok(preview.text.includes("💰 Còn phải thu: 100.000 VND"));
});

test("two-tier reconciliation settlement flow", async () => {
  const fake = createFakeFirestore({
    "groups/team": { kind: "shared_bills", status: "active", ownerUid: "manager_uid" },
    "members/payer": { name: "Fronting Member", groupId: "team" },
    "members/other": { name: "Other Member", groupId: "team" },
  });
  const now = new Date("2026-11-01T03:00:00Z");
  const service = createBillService({ ...fake, now: () => now });

  const created = await service.create({
    groupId: "team",
    billId: "bill-1",
    actorUid: "manager_uid",
    input: {
      title: "Spotify Family",
      amountVnd: 200000,
      settlementMode: "full_collection",
      participantIds: ["payer", "other"],
      providerPayerMemberId: "payer",
      billingDate: "2026-11-01",
      dueDate: "2026-11-05",
    },
  });

  const detail = await service.detail("team", "bill-1");
  assert.equal(detail.reconciliation.tier1Payout.recipientRole, "GROUP_MANAGER");
  assert.equal(detail.reconciliation.tier1Payout.amountVnd, 200000);
  assert.equal(detail.reconciliation.tier2Payout.memberId, "payer");
  assert.equal(detail.reconciliation.tier2Payout.amountVnd, 200000);

  // Super Admin settles Tier 1
  await service.settleTier1Payout({
    groupId: "team",
    billId: "bill-1",
    actorUid: "superadmin_uid",
    reference: "VQR123",
  });
  const afterTier1 = await service.detail("team", "bill-1");
  assert.equal(afterTier1.reconciliation.tier1Payout.status, "SETTLED");
  assert.equal(afterTier1.reconciliation.tier1Payout.transactionReference, "VQR123");

  // Manager settles Tier 2
  await service.settleTier2Payout({
    groupId: "team",
    billId: "bill-1",
    actorUid: "manager_uid",
    reference: "INT999",
  });
  const afterTier2 = await service.detail("team", "bill-1");
  assert.equal(afterTier2.reconciliation.tier2Payout.status, "SETTLED");
});

test("per-bill reminderMode controls notification scheduling", async () => {
  const fake = createFakeFirestore({
    "groups/team": { name: "Team", kind: "shared_bills", status: "active", ownerUid: "superadmin_uid" },
    "groups/team/settings/telegram": { enabled: true, version: 1, events: ["opened", "due", "overdue"] },
    "groups/team/settings/slack": { enabled: false },
    "platformAccounts/superadmin_uid": { role: "owner" },
    "members/payer": { name: "Payer", groupId: "team" },
    "members/other": { name: "Other", groupId: "team" },
  });

  const service = createBillService({
    ...fake,
    now: () => new Date("2026-11-01T08:00:00+07:00"),
  });

  // 1. Bill with reminderMode: "none"
  await service.create({
    groupId: "team",
    billId: "bill-silent",
    actorUid: "superadmin_uid",
    input: {
      title: "Silent Bill",
      amountVnd: 100000,
      settlementMode: "full_collection",
      reminderMode: "none",
      participantIds: ["payer", "other"],
      providerPayerMemberId: "payer",
      billingDate: "2026-11-01",
      dueDate: "2026-11-05",
    },
  });

  const silentJobs = [...fake.records.keys()].filter((k) => k.startsWith("billNotificationJobs/team_bill-silent"));
  assert.equal(silentJobs.length, 0, "Silent bill should have 0 notification jobs");

  // 2. Bill with reminderMode: "bill_only"
  await service.create({
    groupId: "team",
    billId: "bill-only",
    actorUid: "superadmin_uid",
    input: {
      title: "Bill Only",
      amountVnd: 100000,
      settlementMode: "full_collection",
      reminderMode: "bill_only",
      participantIds: ["payer", "other"],
      providerPayerMemberId: "payer",
      billingDate: "2026-11-01",
      dueDate: "2026-11-05",
    },
  });

  const billOnlyJobs = [...fake.records.keys()].filter((k) => k.startsWith("billNotificationJobs/team_bill-only"));
  assert.equal(billOnlyJobs.length, 1, "bill_only should only schedule opened job");
  assert.ok(billOnlyJobs[0].includes("_opened_"), "Job should be opened event");
});

