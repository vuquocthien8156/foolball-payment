import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../server/package.json", import.meta.url));
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Local Firestore emulator required");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { createBillService } = require("./lib/bills.js");
const { createTelegramConnections } = require("./lib/telegramConnections.js");
const app = admin.initializeApp({ projectId: "demo-football" }, "shared-bill-transactions");
const db = app.firestore();

test("real Firestore transactions deduplicate concurrent bill creation and payment confirmation", async (t) => {
  t.after(() => app.delete());
  const groupId = `bill-tx-${Date.now()}`;
  await db.doc(`groups/${groupId}`).set({ kind: "shared_bills", status: "active" });
  for (const id of ["owner", "friend"]) await db.doc(`members/${groupId}-${id}`).set({ groupId, name: id });
  const service = createBillService({ db, FieldValue });
  const input = { title: "Netflix", amountVnd: 260000, participantIds: [`${groupId}-owner`, `${groupId}-friend`], providerPayerMemberId: `${groupId}-owner`, billingDate: "2026-11-01", dueDate: "2026-11-05" };
  const results = await Promise.all([1, 2, 3].map(() => service.create({ groupId, billId: "november", input, actorUid: "manager" })));
  assert.equal(results.filter((result) => !result.duplicate).length, 1);
  const command = { groupId, billId: "november", actorUid: "manager", memberId: `${groupId}-friend`, requestId: "same-request", action: "confirm" };
  await Promise.all([1, 2, 3].map(() => service.payment(command)));
  const bill = await service.detail(groupId, "november");
  assert.equal(bill.events.filter((event) => event.type === "confirm").length, 1);
  assert.equal(bill.summary.confirmedReimbursements, 130000);
  assert.equal(bill.state, "closed");
  assert.ok(Number.isFinite(bill.events[0].createdAt.seconds));
  const wire = JSON.parse(JSON.stringify(bill));
  assert.ok(Number.isFinite(wire.allocations.find((allocation) => allocation.state === "paid").paidAt.seconds));
  await db.doc(`groups/${groupId}`).set({ ownerUid: "alice" }, { merge: true });
  const secondGroup = `${groupId}-second`;
  await db.doc(`groups/${secondGroup}`).set({ status: "active", ownerUid: "bob" });
  const chatId = -Date.now();
  const client = { configured: true, call: async (method) => {
    if (method === "getMe") return { ok: true, result: { id: 123, username: "TestBot" } };
    if (method === "getChatAdministrators") return { ok: true, result: [{ user: { id: 10 }, status: "administrator" }] };
    if (method === "getChatMember") return { ok: true, result: { status: "member" } };
    return { ok: true, result: { id: chatId, type: "supergroup", title: "Test chat" } };
  } };
  const connections = createTelegramConnections({ db, FieldValue, client });
  const first = await connections.create(groupId, "alice"), second = await connections.create(secondGroup, "bob");
  for (const [index, attempt] of [first, second].entries()) await connections.receive({ update_id: Date.now() + index,
    message: { from: { id: 10 }, chat: { id: chatId, type: "supergroup" }, text: `/start@TestBot ${new URL(attempt.url).searchParams.get("startgroup")}` } });
  const confirmations = await Promise.allSettled([connections.confirm(groupId, first.id, "alice"), connections.confirm(secondGroup, second.id, "bob")]);
  assert.equal(confirmations.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(confirmations.find((result) => result.status === "rejected").reason.message, "DESTINATION_ALREADY_CONNECTED");
});
