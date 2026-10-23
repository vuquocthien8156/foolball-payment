import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createFakeFirestore } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const { splitBill, createBillService } = require("../../server/lib/bills.js");

const participants = ["e", "d", "c", "b", "a"].map((id) => ({ id, name: id.toUpperCase() }));
const input = { title: "Netflix", amountVnd: 260000, participantIds: participants.map((p) => p.id), providerPayerMemberId: "a", billingDate: "2026-11-01", dueDate: "2026-11-05" };
function setup() {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active" },
    ...Object.fromEntries(participants.map((p) => [`members/${p.id}`, { name: p.name, groupId: "netflix" }])),
  });
  return { ...fake, service: createBillService(fake) };
}

test("equal VND split conserves every dong and records payer contribution separately", () => {
  const split = splitBill({ amountVnd: 260000, participants, providerPayerMemberId: "a" });
  assert.deepEqual(split.map((p) => p.amountVnd), [52000, 52000, 52000, 52000, 52000]);
  assert.equal(split[0].state, "covered_by_payer");
  const remainder = splitBill({ amountVnd: 11, participants, providerPayerMemberId: "a" });
  assert.deepEqual(remainder.map((p) => p.amountVnd), [3, 2, 2, 2, 2]);
});

test("invalid split inputs never produce allocations", () => {
  for (const amountVnd of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 4]) {
    assert.throws(() => splitBill({ amountVnd, participants, providerPayerMemberId: "a" }));
  }
  assert.throws(() => splitBill({ amountVnd: 100, participants: [], providerPayerMemberId: "a" }));
  assert.throws(() => splitBill({ amountVnd: 100, participants: [participants[0], participants[0]], providerPayerMemberId: "e" }));
  assert.throws(() => splitBill({ amountVnd: 100, participants, providerPayerMemberId: "outside" }));
});

test("bill creation is idempotent; payment/reversal preserve history and reimbursement math", async () => {
  const { service, records } = setup();
  await service.create({ groupId: "netflix", billId: "november", input, actorUid: "owner" });
  await service.create({ groupId: "netflix", billId: "november", input, actorUid: "owner" });
  let bill = await service.detail("netflix", "november");
  assert.equal(bill.events.length, 1);
  assert.equal(bill.summary.expectedReimbursements, 208000);
  assert.equal(bill.summary.payerContribution, 52000);
  const command = { groupId: "netflix", billId: "november", memberId: "b", actorUid: "owner", requestId: "payment-one", action: "confirm", note: "Bank received" };
  await service.payment(command);
  await service.payment(command);
  bill = await service.detail("netflix", "november");
  assert.equal(bill.events.length, 2);
  assert.equal(bill.summary.confirmedReimbursements, 52000);
  assert.equal(bill.summary.outstanding, 156000);
  await service.payment({ ...command, requestId: "reverse-one", action: "reverse", note: "Wrong member" });
  bill = await service.detail("netflix", "november");
  assert.equal(bill.events.length, 3);
  assert.equal(bill.summary.outstanding, 208000);
  assert.equal(records.get("groups/netflix/bills/november/allocations/b").state, "unpaid");
});

test("foreign/inactive participants and invalid dates leave no bill behind", async () => {
  const { service, records } = setup();
  records.set("members/foreign", { name: "Foreign", groupId: "other-group" });
  records.set("members/inactive", { name: "Inactive", groupId: "netflix", inactive: true });
  for (const bad of [{ participantIds: ["foreign"] }, { participantIds: ["inactive"] }, { billingDate: "2026-02-30" }, { dueDate: "2026-10-01" }]) {
    await assert.rejects(service.create({ groupId: "netflix", billId: "invalid", input: { ...input, ...bad }, actorUid: "owner" }));
    assert.equal(records.has("groups/netflix/bills/invalid"), false);
  }
});

test("voiding preserves history and requires received transfers to be corrected first", async () => {
  const { service } = setup();
  await service.create({ groupId: "netflix", billId: "void-test", input, actorUid: "owner" });
  await service.payment({ groupId: "netflix", billId: "void-test", memberId: "b", actorUid: "owner", requestId: "paid", action: "confirm" });
  await assert.rejects(service.voidBill("netflix", "void-test", "owner", "Duplicate bill"), /PAYMENTS_REQUIRE_CORRECTION/);
  await service.payment({ groupId: "netflix", billId: "void-test", memberId: "b", actorUid: "owner", requestId: "corrected", action: "reverse", note: "Transfer returned manually" });
  await service.voidBill("netflix", "void-test", "owner", "Duplicate bill");
  const bill = await service.detail("netflix", "void-test");
  assert.equal(bill.state, "voided");
  assert.equal(bill.events.length, 4);
});
