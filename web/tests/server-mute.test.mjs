import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import groups from "../../server/lib/groups.js";
import { createFakeFirestore } from "./fake-firestore.mjs";

function loadCjs(path, mocks, context = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(path, import.meta.url), "utf8"), {
    module, exports: module.exports, process, console: { log() {}, warn() {}, error() {} },
    require: (name) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked: ${name}`); }, ...context,
  });
  return module.exports;
}
function extract(name, context) {
  const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
  const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
  let code;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(root) === name) code = node.initializer.getText(root);
    if (ts.isCallExpression(node) && node.arguments[0]?.text === name) code = node.arguments.at(-1).getText(root);
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(code, name);
  return vm.runInNewContext(`(${code})`, context);
}
async function call(handler, body) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body }, res);
  return res;
}

test("emulator mutes Slack, both push paths and payOS; normal mode preserves sends", async () => {
  const original = process.env.FUNCTIONS_EMULATOR;
  try {
    for (const muted of [true, false]) {
      if (muted) process.env.FUNCTIONS_EMULATOR = "true";
      else delete process.env.FUNCTIONS_EMULATOR;
      const { isMuted } = loadCjs("../../server/lib/mute.js", {});
      assert.equal(isMuted(), muted);
      const sends = [];
      const slack = loadCjs("../../server/lib/slack.js", {
        axios: { post: async () => sends.push("slack") }, "./slackConfig": { TIMEZONE: "Asia/Ho_Chi_Minh" }, "./mute": { isMuted },
      }, { process: { env: { SLACK_WEBHOOK_URL: "http://slack.test.invalid", FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR } } });
      assert.equal(await slack.postToSlack({ text: "Test" }), true);
      const { db, records, FieldValue } = createFakeFirestore({
        "members/a": { name: "Demo", fcmToken: "fake-a" },
        "matches/m1": { status: "PUBLISHED", date: "2026-10-20" },
        "matches/m1/rosters/A": { memberIds: ["a"] },
        "matches/m1/shares/s1": { memberId: "a", matchId: "m1", amount: 10000, status: "PENDING" },
      });
      const result = { successCount: 1, failureCount: 0, responses: [{ success: true }] };
      const messaging = {
        sendEachForMulticast: async () => { sends.push("push-each"); return result; },
        sendMulticast: async () => { sends.push("push-direct"); return result; },
      };
      const firestore = Object.assign(() => db, { FieldValue, FieldPath: { documentId: () => "__name__" } });
      const context = {
        ...groups, URL, FieldValue, FieldPath: { documentId: () => "__name__" },
        collectGroupTokens: async () => ["fake-a"],
        admin: { firestore, messaging: () => messaging }, isMuted,
        cleanUpInvalidTokens: () => { throw new Error("No cleanup expected"); },
        chunkArray: (items, count) => Array.from({ length: Math.ceil(items.length / count) }, (_, i) => items.slice(i * count, (i + 1) * count)),
        slack: { formatMatchDateOnly: () => "20/10/2026" },
        payos: { paymentRequests: { create: async () => { sends.push("payos"); return { checkoutUrl: "http://payos.test.invalid" }; } } },
        process: { env: { PAYOS_RETURN_URL: "http://localhost/success", PAYOS_CANCEL_URL: "http://localhost/cancel" } },
        console: { log() {}, error() {} }, Date, Set,
      };
      const push = await extract("sendPushToTokens", context)(["fake-a"], { notification: { title: "Test" } });
      assert.equal(push.successCount, muted ? 0 : 1);
      assert.equal(push.failureCount, 0);
      assert.equal(push.invalidTokens, 0);
      assert.equal((await call(extract("/send-match-notification", context), { matchId: "m1" })).statusCode, 200);
      const payment = await call(extract("/create-payment-link", context), { memberId: "a", shareIds: ["s1"] });
      assert.equal(payment.statusCode, 200);
      if (muted) {
        assert.match(payment.body.checkoutUrl, /^\/public\/payment-cancel\?mock=1&orderCode=\d+$/);
        assert.equal(typeof payment.body.orderCode, "number");
        assert.equal(records.get(`paymentRequests/${payment.body.orderCode}`).status, "PENDING");
        assert.equal(records.get("matches/m1/shares/s1").payosOrderCode, payment.body.orderCode);
        assert.equal(records.get("matches/m1/shares/s1").status, "PENDING");
      }
      assert.deepEqual(sends, muted ? [] : ["slack", "push-each", "push-direct", "payos"]);
    }
  } finally {
    if (original === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = original;
  }
});
