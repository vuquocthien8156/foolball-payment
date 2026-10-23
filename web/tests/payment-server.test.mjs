import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import groups from "../../server/lib/groups.js";

const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
function findHandler(name) {
  let result;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments[0]?.text === name) result = node.arguments[1].getText(root);
    if (ts.isVariableDeclaration(node) && node.name.getText(root) === name) result = node.initializer.getText(root);
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(result, `Missing real handler ${name}`);
  return result;
}

function setup(overrides = {}) {
  const records = new Map(Object.entries({
    "members/alice": { name: "Alice" }, "members/bob": { name: "Bob" },
    "matches/m1": { status: "PUBLISHED" }, "matches/m2": { status: "PUBLISHED" },
    "matches/m1/shares/same-id": { memberId: "alice", matchId: "m1", amount: 10000, status: "PENDING" },
    "matches/m2/shares/same-id": { memberId: "bob", matchId: "m2", amount: 20000, status: "PENDING" },
    ...overrides,
  }));
  const payments = [];
  let counter = 0;
  const snap = (path) => ({ id: path.split("/").at(-1), exists: records.has(path), ref: doc(path), data: () => records.get(path) });
  const write = (path, data, merge) => records.set(path, merge ? { ...records.get(path), ...data } : data);
  const doc = (path) => ({ path, id: path.split("/").at(-1),
    get: async () => snap(path), set: async (data) => write(path, data),
    collection: (name) => collection(`${path}/${name}`),
  });
  const query = (filter, constraints = []) => ({
    where: (field, op, value) => query(filter, [...constraints, [field, op, value]]),
    get: async () => {
      const docs = [...records.keys()].filter((path) => filter(path) && constraints.every(([field, op, value]) => {
        assert.equal(op, "==");
        return records.get(path)[field] === value;
      })).map(snap);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const collection = (path) => ({
    ...query((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1),
    doc: (id = `auto-${++counter}`) => doc(`${path}/${id}`),
    add: async (data) => write(`${path}/auto-${++counter}`, data),
  });
  const db = {
    doc, collection, getAll: async (...refs) => refs.map((ref) => snap(ref.path)),
    collectionGroup: (name) => query((path) => path.split("/").at(-2) === name),
    batch: () => {
      const writes = [];
      return { update: (ref, data) => writes.push(() => write(ref.path, data, true)), commit: async () => writes.forEach((fn) => fn()) };
    },
    runTransaction: async (fn) => {
      const writes = [];
      await fn({ get: async (ref) => ref.get(), getAll: db.getAll,
        update: (ref, data) => writes.push(() => write(ref.path, data, true)),
        set: (ref, data) => writes.push(() => write(ref.path, data)),
      });
      writes.forEach((fn) => fn());
    },
  };
  const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => "server-time" } });
  const context = { ...groups, URL, FieldValue: firestore.FieldValue, admin: { firestore }, isMuted: () => false, payos: {
    paymentRequests: { create: async (data) => { payments.push(data); return { checkoutUrl: "https://checkout.test/order" }; } },
    webhooks: { verify: async (body) => body },
  }, process: { env: { PAYOS_RETURN_URL: "http://localhost/success", PAYOS_CANCEL_URL: "http://localhost/cancel" } },
  console: { log() {}, error() {} }, Date, Set };
  const create = vm.runInNewContext(`(${findHandler("/create-payment-link")})`, context);
  const webhook = vm.runInNewContext(`(${findHandler("payosWebhookHandler")})`, context);
  const call = async (handler, body) => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
    await handler({ body }, response);
    return response;
  };
  return { records, payments, create: (body) => call(create, body), webhook: (body) => call(webhook, body) };
}

const groupRequest = { memberId: "alice", memberIds: ["alice", "bob"],
  sharePaths: ["matches/m1/shares/same-id", "matches/m2/shares/same-id"], ratings: [] };

test("one checkout pays both owners, even with duplicate document IDs", async () => {
  const host = setup();
  const response = await host.create(groupRequest);
  assert.equal(response.statusCode, 200);
  assert.equal(host.payments.length, 1);
  assert.equal(host.payments[0].amount, 30000);
  const { orderCode } = host.payments[0];
  const paid = await host.webhook({ code: "00", orderCode, amount: 30000 });
  assert.equal(paid.statusCode, 200);
  for (const path of groupRequest.sharePaths) assert.equal(host.records.get(path).status, "PAID");
  const notifications = [...host.records].filter(([path]) => path.startsWith("notifications/"));
  assert.equal(notifications.length, 2);
  assert.ok(notifications.some(([, data]) => data.message.includes("Bob")));
  assert.ok(notifications.some(([, data]) => data.message.includes("Alice")));
  const count = host.records.size;
  await host.webhook({ code: "00", orderCode, amount: 30000 });
  assert.equal(host.records.size, count, "retry must not duplicate notifications or payment queue");
});

test("legacy single-member checkout still works", async () => {
  const host = setup();
  assert.equal((await host.create({ memberId: "alice", shareIds: ["same-id"] })).statusCode, 200);
  assert.equal(host.payments[0].amount, 10000);
  const { orderCode, amount } = host.payments[0];
  assert.equal((await host.webhook({ code: "00", orderCode, amount })).statusCode, 200);
  assert.equal(host.records.get(groupRequest.sharePaths[0]).status, "PAID");
  assert.equal(host.records.get(groupRequest.sharePaths[1]).status, "PENDING");
});

test("group request rejects malformed, duplicate, missing, unowned, or stale debts without checkout", async () => {
  for (const change of [
    { sharePaths: ["members/alice"] }, { sharePaths: [] },
    { sharePaths: [groupRequest.sharePaths[0], groupRequest.sharePaths[0]] },
    { sharePaths: [groupRequest.sharePaths[0], "matches/m2/shares/missing"] },
    { memberIds: ["alice"] }, { memberIds: ["bob"] },
  ]) {
    const host = setup();
    const response = await host.create({ ...groupRequest, ...change });
    assert.ok(response.statusCode >= 400);
    assert.equal(host.payments.length, 0);
  }
  for (const override of [
    { "matches/m2/shares/same-id": { memberId: "bob", amount: 20000, status: "PAID" } },
    { "matches/m2/shares/same-id": { memberId: "bob", amount: -1, status: "PENDING" } },
    { "matches/m2": { status: "PENDING" } },
    { "matches/m2": { status: "PUBLISHED", isDeleted: true } },
  ]) {
    const host = setup(override);
    assert.ok((await host.create(groupRequest)).statusCode >= 400);
    assert.equal(host.payments.length, 0);
  }
});

test("a newer checkout cannot detach debts from an older paid order", async () => {
  const host = setup();
  await host.create(groupRequest);
  assert.equal(host.payments.length, 1);
  const first = host.payments[0];
  host.records.get(groupRequest.sharePaths[0]).payosOrderCode = first.orderCode + 1;
  assert.equal((await host.webhook({ code: "00", orderCode: first.orderCode, amount: first.amount })).statusCode, 200);
  for (const path of groupRequest.sharePaths) assert.equal(host.records.get(path).status, "PAID");
});

test("webhook for an order created before this change remains compatible", async () => {
  const host = setup({
    "paymentRequests/123": { memberId: "alice", shareIds: ["same-id"], status: "PENDING" },
    "matches/m1/shares/same-id": { memberId: "alice", matchId: "m1", amount: 10000, status: "PENDING", payosOrderCode: 123 },
  });
  assert.equal((await host.webhook({ code: "00", orderCode: 123, amount: 10000 })).statusCode, 200);
  assert.equal(host.records.get(groupRequest.sharePaths[0]).status, "PAID");
  assert.equal(host.records.get(groupRequest.sharePaths[1]).status, "PENDING");
});

test("wrong payment amount or changed debts cannot mark a group paid", async () => {
  for (const kind of ["amount", "deleted", "changed"]) {
    const host = setup();
    await host.create(groupRequest);
    const { orderCode } = host.payments[0];
    if (kind === "deleted") host.records.delete(groupRequest.sharePaths[1]);
    if (kind === "changed") host.records.get(groupRequest.sharePaths[1]).amount = 40000;
    const response = await host.webhook({ code: "00", orderCode, amount: kind === "amount" ? 1 : 30000 });
    assert.equal(response.statusCode, 500);
    assert.equal(host.records.get(groupRequest.sharePaths[0]).status, "PENDING");
    assert.equal(host.records.get(`paymentRequests/${orderCode}`).status, "PENDING");
  }
});
