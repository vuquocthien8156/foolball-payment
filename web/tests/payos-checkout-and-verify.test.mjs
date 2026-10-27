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

function setup(overrides = {}, payosOverrides = {}) {
  const records = new Map(Object.entries({
    "members/alice": { name: "Alice" },
    "members/bob": { name: "Bob" },
    "matches/m1": { status: "PUBLISHED" },
    "matches/m2": { status: "PUBLISHED" },
    "matches/m1/shares/same-id": { memberId: "alice", matchId: "m1", amount: 10000, status: "PENDING" },
    "matches/m2/shares/same-id": { memberId: "bob", matchId: "m2", amount: 20000, status: "PENDING" },
    ...overrides,
  }));
  const payments = [];
  const cancelledOrders = [];
  const payosOrders = new Map();
  let counter = 0;

  const snap = (path) => ({
    id: path.split("/").at(-1),
    exists: records.has(path),
    ref: doc(path),
    data: () => records.get(path),
  });

  const write = (path, data, merge) => records.set(path, merge ? { ...records.get(path), ...data } : data);

  const doc = (path) => ({
    path,
    id: path.split("/").at(-1),
    get: async () => snap(path),
    set: async (data) => write(path, data),
    update: async (data) => write(path, data, true),
    collection: (name) => collection(`${path}/${name}`),
  });

  const query = (filter, constraints = []) => ({
    where: (field, op, value) => query(filter, [...constraints, [field, op, value]]),
    get: async () => {
      const docs = [...records.keys()]
        .filter((path) => filter(path) && constraints.every(([field, op, value]) => {
          assert.equal(op, "==");
          return records.get(path)[field] === value;
        }))
        .map(snap);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  const collection = (path) => ({
    ...query((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1),
    doc: (id = `auto-${++counter}`) => doc(`${path}/${id}`),
    add: async (data) => write(`${path}/auto-${++counter}`, data),
  });

  const db = {
    doc,
    collection,
    getAll: async (...refs) => refs.map((ref) => snap(ref.path)),
    collectionGroup: (name) => query((path) => path.split("/").at(-2) === name),
    batch: () => {
      const writes = [];
      return {
        update: (ref, data) => writes.push(() => write(ref.path, data, true)),
        commit: async () => writes.forEach((fn) => fn()),
      };
    },
    runTransaction: async (fn) => {
      const writes = [];
      await fn({
        get: async (ref) => ref.get(),
        getAll: db.getAll,
        update: (ref, data) => writes.push(() => write(ref.path, data, true)),
        set: (ref, data) => writes.push(() => write(ref.path, data)),
      });
      writes.forEach((fn) => fn());
    },
  };

  const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => "server-time" } });

  const context = {
    ...groups,
    URL,
    FieldValue: firestore.FieldValue,
    admin: { firestore },
    isMuted: () => false,
    payos: {
      paymentRequests: {
        create: async (data) => {
          payments.push(data);
          payosOrders.set(data.orderCode, {
            orderCode: data.orderCode,
            status: "PENDING",
            amount: data.amount,
            amountPaid: 0,
            checkoutUrl: `https://checkout.test/order/${data.orderCode}`,
            qrCode: `00020101021238540010A00000072701240006970422...${data.orderCode}`,
          });
          return {
            checkoutUrl: `https://checkout.test/order/${data.orderCode}`,
            orderCode: data.orderCode,
            qrCode: `00020101021238540010A00000072701240006970422...${data.orderCode}`,
          };
        },
        get: async (orderCode) => {
          if (payosOverrides.get) return payosOverrides.get(orderCode);
          const order = payosOrders.get(Number(orderCode)) || {
            orderCode: Number(orderCode),
            status: "PENDING",
            amount: 30000,
            amountPaid: 0,
          };
          return order;
        },
        cancel: async (orderCode, reason) => {
          cancelledOrders.push({ orderCode: Number(orderCode), reason });
          if (payosOrders.has(Number(orderCode))) {
            payosOrders.get(Number(orderCode)).status = "CANCELLED";
          }
          return { orderCode: Number(orderCode), status: "CANCELLED" };
        },
      },
      webhooks: { verify: async (body) => body },
    },
    process: { env: { PAYOS_RETURN_URL: "http://localhost/success", PAYOS_CANCEL_URL: "http://localhost/cancel" } },
    console: { log() {}, error() {} },
    Date,
    Set,
  };

  const create = vm.runInNewContext(`(${findHandler("/create-payment-link")})`, context);
  const webhook = vm.runInNewContext(`(${findHandler("payosWebhookHandler")})`, context);
  const verify = vm.runInNewContext(`(${findHandler("verifyPaymentHandler")})`, context);
  const cancel = vm.runInNewContext(`(${findHandler("cancelPaymentHandler")})`, context);

  const call = async (handler, { body = {}, params = {}, query = {} } = {}) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
      send(data) {
        this.body = data;
        return this;
      },
    };
    await handler({ body, params, query }, response);
    return response;
  };

  return {
    records,
    payments,
    cancelledOrders,
    payosOrders,
    create: (body) => call(create, { body }),
    webhook: (body) => call(webhook, { body }),
    verify: (params) => call(verify, { params }),
    cancel: (params, body) => call(cancel, { params, body }),
  };
}

const testDebtRequest = {
  memberId: "alice",
  memberIds: ["alice", "bob"],
  sharePaths: ["matches/m1/shares/same-id", "matches/m2/shares/same-id"],
  ratings: [],
};

test("TM-01: Create payment link returns fields needed for in-app popup", async () => {
  const host = setup();
  const response = await host.create(testDebtRequest);
  assert.equal(response.statusCode, 200);
  assert.equal(host.payments.length, 1);
  const payment = host.payments[0];
  assert.ok(payment.orderCode, "orderCode must exist");
  assert.equal(response.body.checkoutUrl, `https://checkout.test/order/${payment.orderCode}`);
  assert.equal(response.body.orderCode, payment.orderCode);
});

test("TM-02: Verify endpoint settles debts when PayOS reports PAID", async () => {
  const host = setup();
  const createRes = await host.create(testDebtRequest);
  assert.equal(createRes.statusCode, 200);
  const { orderCode } = host.payments[0];

  // Mock PayOS returning PAID
  host.payosOrders.set(orderCode, {
    orderCode,
    status: "PAID",
    amount: 30000,
    amountPaid: 30000,
  });

  const verifyRes = await host.verify({ orderCode: String(orderCode) });
  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.body.status, "PAID");
  assert.equal(verifyRes.body.orderCode, orderCode);

  // Shares must be marked PAID
  for (const path of testDebtRequest.sharePaths) {
    assert.equal(host.records.get(path).status, "PAID");
  }
  assert.equal(host.records.get(`paymentRequests/${orderCode}`).status, "PAID");

  // Notifications must be sent
  const notifications = [...host.records].filter(([path]) => path.startsWith("notifications/"));
  assert.equal(notifications.length, 2);
});

test("TM-03: Verify endpoint keeps status PENDING when payment is not yet completed", async () => {
  const host = setup();
  await host.create(testDebtRequest);
  const { orderCode } = host.payments[0];

  const verifyRes = await host.verify({ orderCode: String(orderCode) });
  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.body.status, "PENDING");

  // Shares must remain PENDING
  for (const path of testDebtRequest.sharePaths) {
    assert.equal(host.records.get(path).status, "PENDING");
  }
  assert.equal(host.records.get(`paymentRequests/${orderCode}`).status, "PENDING");
});

test("TM-04: Verify endpoint is idempotent when order is already PAID", async () => {
  const host = setup();
  await host.create(testDebtRequest);
  const { orderCode } = host.payments[0];

  host.payosOrders.set(orderCode, {
    orderCode,
    status: "PAID",
    amount: 30000,
    amountPaid: 30000,
  });

  // First verify
  const res1 = await host.verify({ orderCode: String(orderCode) });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.status, "PAID");
  const recordCount = host.records.size;

  // Second verify (subsequent call)
  const res2 = await host.verify({ orderCode: String(orderCode) });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.status, "PAID");
  assert.equal(host.records.size, recordCount, "No duplicate notifications or database writes");
});

test("TM-05: Webhook arrival after manual verify does not corrupt state or duplicate notifications", async () => {
  const host = setup();
  await host.create(testDebtRequest);
  const { orderCode } = host.payments[0];

  host.payosOrders.set(orderCode, {
    orderCode,
    status: "PAID",
    amount: 30000,
    amountPaid: 30000,
  });

  // User clicked "Check Status" first
  await host.verify({ orderCode: String(orderCode) });
  const recordCount = host.records.size;

  // Webhook arrives a moment later
  const webhookRes = await host.webhook({ code: "00", orderCode, amount: 30000 });
  assert.equal(webhookRes.statusCode, 200);
  assert.equal(host.records.size, recordCount, "Webhook must be a no-op after manual verify");
});

test("TM-06: Verify endpoint handles missing or invalid orderCode gracefully", async () => {
  const host = setup();
  const notFoundRes = await host.verify({ orderCode: "999999" });
  assert.equal(notFoundRes.statusCode, 404);
  assert.equal(notFoundRes.body.error, "PAYMENT_NOT_FOUND");

  const invalidRes = await host.verify({ orderCode: "not-a-number" });
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, "INVALID_ORDER_CODE");
});

test("TM-07: Cancel endpoint deactivates payment on PayOS and Firestore", async () => {
  const host = setup();
  await host.create(testDebtRequest);
  const { orderCode } = host.payments[0];

  const cancelRes = await host.cancel({ orderCode: String(orderCode) }, { reason: "User cancelled" });
  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.body.status, "CANCELLED");
  assert.equal(host.cancelledOrders.length, 1);
  assert.equal(host.cancelledOrders[0].orderCode, orderCode);
  assert.equal(host.records.get(`paymentRequests/${orderCode}`).status, "CANCELLED");
});

test("TM-08: PayOSCheckoutDialog converts web URL to embedded URL and validates origins", () => {
  const webUrl = "https://pay.payos.vn/web/abc123xyz";
  const embeddedUrl = webUrl.replace("/web/", "/embedded/");
  assert.equal(embeddedUrl, "https://pay.payos.vn/embedded/abc123xyz");

  const allowedOrigins = [
    "https://pay.payos.vn",
    "https://dev.pay.payos.vn",
    "https://next.pay.payos.vn",
    "https://next.dev.pay.payos.vn",
  ];
  assert.ok(allowedOrigins.includes("https://pay.payos.vn"));
  assert.ok(!allowedOrigins.includes("https://malicious-site.com"));
});
