import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import groups from "../../server/lib/groups.js";
import { createFakeFirestore } from "./fake-firestore.mjs";
const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
function extract(name, context) {
  let code;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments[0]?.text === name) code = node.arguments[1].getText(root);
    if (ts.isVariableDeclaration(node) && node.name.getText(root) === name) code = node.initializer.getText(root);
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(code);
  return vm.runInNewContext(`(${code})`, context);
}
function setup(t, gid = "football-zigvy", extra = {}) {
  const previous = process.env.FUNCTIONS_EMULATOR;
  delete process.env.FUNCTIONS_EMULATOR;
  t.after(() => { if (previous === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = previous; });
  const fake = createFakeFirestore({
    "members/a": { groupId: gid, name: "A" }, "members/b": { groupId: gid, name: "B" },
    "matches/m1": { groupId: gid, status: "PUBLISHED" }, "matches/m2": { groupId: gid, status: "PUBLISHED" },
    "matches/m1/shares/a": { groupId: gid, memberId: "a", matchId: "m1", amount: 10000, status: "PENDING" },
    "matches/m2/shares/b": { groupId: gid, memberId: "b", matchId: "m2", amount: 20000, status: "PENDING" },
    ...extra,
  });
  const payments = [];
  const firestore = Object.assign(() => fake.db, { FieldValue: fake.FieldValue });
  const context = { ...groups, URL, FieldValue: fake.FieldValue, Date, Set, isMuted: () => false,
    admin: { firestore }, payos: { paymentRequests: { create: async (data) => { payments.push(data); return { checkoutUrl: "/fake-checkout", orderCode: data.orderCode }; } }, webhooks: { verify: async (body) => body } },
    process: { env: { PAYOS_RETURN_URL: "https://web.test/public/payment-success?old=1", PAYOS_CANCEL_URL: "https://web.test/public/payment-cancel" } },
    console: { log() {}, error() {} },
  };
  const call = async (handler, body) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ body }, res);
    return res;
  };
  return { ...fake, payments, create: (body) => call(extract("/create-payment-link", context), body), webhook: (body) => call(extract("payosWebhookHandler", context), body) };
}
const request = { memberId: "a", memberIds: ["a", "b"], sharePaths: ["matches/m1/shares/a", "matches/m2/shares/b"], ratings: [] };
test("missing groupId defaults to football; request stores groupId; default return URL unchanged", async (t) => {
  const host = setup(t);
  assert.equal((await host.create(request)).statusCode, 200);
  const payment = host.payments[0];
  assert.equal(host.records.get(`paymentRequests/${payment.orderCode}`).groupId, "football-zigvy");
  assert.equal(payment.returnUrl, "https://web.test/public/payment-success?old=1");
});
test("invalid groupId 400 before checkout", async (t) => {
  const host = setup(t);
  const result = await host.create({ ...request, groupId: "BAD/ID" });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, "INVALID_GROUP");
  assert.equal(host.payments.length, 0);
});
test("mixed group shares or parent matches reject 409 MIXED_GROUP", async (t) => {
  for (const extra of [
    { "matches/m2/shares/b": { groupId: "badm-1", memberId: "b", matchId: "m2", amount: 20000, status: "PENDING" } },
    { "matches/m2": { groupId: "badm-1", status: "PUBLISHED" } },
  ]) {
    const host = setup(t, "football-zigvy", extra);
    const result = await host.create(request);
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error, "MIXED_GROUP");
    assert.equal(host.payments.length, 0);
  }
});
test("non-default return/cancel URLs use group path", async (t) => {
  const host = setup(t, "badm-1");
  assert.equal((await host.create({ ...request, groupId: "badm-1" })).statusCode, 200);
  assert.equal(host.payments[0].returnUrl, "https://web.test/g/badm-1/public/payment-success");
  assert.equal(host.payments[0].cancelUrl, "https://web.test/g/badm-1/public/payment-cancel");
});
test("webhook writes groupId to notification/rating/queue and duplicate is idempotent", async (t) => {
  const host = setup(t, "badm-1");
  await host.create({ ...request, groupId: "badm-1", ratings: [{ matchId: "m1", ratedByMemberId: "a", playerRatings: [{ memberId: "b", score: 5 }], mvpPlayerId: "b" }] });
  const { orderCode, amount } = host.payments[0];
  assert.equal((await host.webhook({ code: "00", orderCode, amount })).statusCode, 200);
  for (const path of ["notifications/", "matches/m1/ratings/", "paymentQueue/"]) {
    const entries = [...host.records].filter(([key]) => key.startsWith(path));
    assert.ok(entries.length, path);
    assert.ok(entries.every(([, data]) => data.groupId === "badm-1"));
  }
  const count = host.log.filter((entry) => entry.op).length;
  await host.webhook({ code: "00", orderCode, amount });
  assert.equal(host.log.filter((entry) => entry.op).length, count);
});
test("legacy request without groupId falls back to football; alreadyPaidShareCount counted", async (t) => {
  const host = setup(t);
  await host.create(request);
  const { orderCode, amount } = host.payments[0];
  delete host.records.get(`paymentRequests/${orderCode}`).groupId;
  delete host.records.get("matches/m1/shares/a").groupId;
  host.records.get("matches/m1/shares/a").status = "PAID";
  assert.equal((await host.webhook({ code: "00", orderCode, amount })).statusCode, 200);
  assert.equal(host.records.get(`paymentRequests/${orderCode}`).alreadyPaidShareCount, 1);
  assert.equal([...host.records].find(([path]) => path.startsWith("paymentQueue/"))[1].groupId, "football-zigvy");
});
test("legacy share-id checkout ignores shares belonging to another group", async (t) => {
  const host = setup(t, "football-zigvy", {
    "matches/m2/shares/a": { groupId: "badm-1", memberId: "a", matchId: "m2", amount: 20000, status: "PENDING" },
  });
  assert.equal((await host.create({ memberId: "a", shareIds: ["a"] })).statusCode, 200);
  assert.equal(host.payments[0].amount, 10000);
});
