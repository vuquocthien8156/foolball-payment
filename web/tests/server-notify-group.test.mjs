import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import groups from "../../server/lib/groups.js";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
function extract(name, context) {
  let code;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(root) === name) code = node.initializer.getText(root);
    if (ts.isCallExpression(node) && node.arguments[0]?.text === name) code = node.arguments.at(-1).getText(root);
    if (ts.isBinaryExpression(node) && node.left.getText(root) === `exports.${name}` && ts.isCallExpression(node.right)) code = node.right.arguments[1].getText(root);
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(code, name);
  return vm.runInNewContext(`(${code})`, context);
}
function setup(t, extra = {}) {
  const previous = process.env.FUNCTIONS_EMULATOR;
  delete process.env.FUNCTIONS_EMULATOR;
  t.after(() => { if (previous === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = previous; });
  const fake = createFakeFirestore({
    "members/a": { name: "Football player", fcmToken: "fake-a", autoAttendance: true },
    "members/b": { groupId: "badm-1", name: "Badminton player", fcmToken: "fake-b", autoAttendance: true },
    "notificationTokens/legacy": { token: "fake-legacy" },
    "notificationTokens/b": { groupId: "badm-1", token: "fake-b" },
    "matches/a": { status: "PUBLISHED", date: Timestamp.now(), totalAmount: 10000 },
    "matches/b": { groupId: "badm-1", status: "PUBLISHED", date: Timestamp.now(), totalAmount: 90000 },
    "matches/a/shares/a": { memberId: "a", matchId: "a", amount: 10000, status: "PENDING" },
    "matches/b/shares/b": { groupId: "badm-1", memberId: "b", matchId: "b", amount: 90000, status: "PENDING" },
    "appConfig/publicPasscode": { passcode: "fake-passcode" }, ...extra,
  });
  const pushes = [], slackCalls = [];
  const firestore = () => fake.db;
  const context = { ...groups, process: { env: {} },
    createGroupTargets: () => ({ getSlackTarget: async (gid) => gid === groups.DEFAULT_GROUP_ID ? { webhookUrl: "https://hook.test.invalid" } : null }),
    admin: { firestore }, FieldValue: fake.FieldValue, FieldPath: { documentId: () => "__name__" }, Timestamp, Date, Set, Map,
    console: { log() {}, error() {} }, TZ: "Asia/Ho_Chi_Minh",
    cfg: { TIMEZONE: "Asia/Ho_Chi_Minh", QUEUE_STALE_HOURS: 24, ATTENDANCE_WARN_HOURS_BEFORE_CLOSE: 4, REMINDER_DAILY_THRESHOLD_DAYS: 5 },
    slack: { PUBLIC_WEB_URL: "https://web.test/public", formatMatchDate: () => "Demo date", formatMatchDateOnly: () => "Demo date", formatVnd: String,
      sendBlock: async (payload) => { slackCalls.push(payload); return true; }, postToSlack: async (payload) => { slackCalls.push(payload); return true; } },
    sendPushToTokens: async (tokens, payload) => { pushes.push({ tokens, payload }); return { successCount: tokens.length, failureCount: 0 }; },
    chunkArray: (items, count) => Array.from({ length: Math.ceil(items.length / count) }, (_, i) => items.slice(i * count, (i + 1) * count)),
  };
  context.collectGroupTokens = extract("collectGroupTokens", context);
  context.recordMemberAction = extract("recordMemberAction", context);
  const call = async (name, body) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await extract(name, context)({ body }, res);
    return res;
  };
  return { ...fake, context, call, pushes, slackCalls, job: (name) => extract(name, context)() };
}
test("push for group B match goes only to B tokens; auto-attendance stays in B; Slack skipped", async (t) => {
  const host = setup(t);
  assert.equal((await host.call("/notify/attendance-created", { matchId: "b", groupId: "badm-1" })).statusCode, 200);
  assert.deepEqual(Array.from(host.pushes[0].tokens), ["fake-b"]);
  assert.equal(host.records.has("matches/b/attendance/a"), false);
  assert.equal(host.records.has("matches/b/attendance/b"), true);
  assert.equal(host.slackCalls.length, 0);
});
test("legacy token without groupId counts as football", async (t) => {
  const host = setup(t);
  assert.deepEqual(Array.from(await host.context.collectGroupTokens("football-zigvy")).sort(), ["fake-a", "fake-legacy"]);
});
test("roster notification works without legacy Firestore namespace statics", async (t) => {
  const host = setup(t, { "members/a": { name: "No subscriber" }, "matches/a/rosters/A": { memberIds: ["a"] } });
  assert.equal((await host.call("/send-match-notification", { matchId: "a" })).statusCode, 200);
  assert.ok(host.log.find((entry) => entry.path === "members" && entry.constraints?.some((condition) => condition.field === "__name__")));
});
test("stored match group rejects conflicting body group across notification endpoints", async (t) => {
  const host = setup(t);
  for (const path of ["/send-match-notification", "/notify/attendance-created", "/notify/attendance-deleted", "/notify/member-action", "/notify/match-published"]) {
    const result = await host.call(path, { matchId: "a", groupId: "badm-1", memberId: "a", action: "ATTEND" });
    assert.equal(result.statusCode, 409, path);
    assert.equal(result.body.error, "MIXED_GROUP", path);
  }
});
test("member-action rejects another-group member even when name supplied; queue entry has groupId", async (t) => {
  const host = setup(t);
  assert.equal((await host.call("/notify/member-action", { matchId: "a", memberId: "b", memberName: "Provided", action: "ATTEND" })).statusCode, 409);
  assert.equal((await host.call("/notify/member-action", { matchId: "b", memberId: "b", action: "ATTEND" })).statusCode, 200);
  assert.equal([...host.records].find(([path]) => path.startsWith("slackQueue/"))[1].groupId, "badm-1");
});
test("public attendance mount reuses member-action queues and immediate cancellation", async (t) => {
  const host = setup(t, { "groups/football-zigvy": { status: "active" }, "matches/a": { status: "PENDING", date: Timestamp.now() } });
  const require = createRequire(new URL("../../server/package.json", import.meta.url));
  host.context.apiRoutes = require("express").Router();
  host.context.createPublicRouter = loadCjs("../../server/lib/publicRoutes.js", { "./groups": groups }).createPublicRouter;
  const mount = root.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(root) === "apiRoutes.use" && node.expression.arguments[0]?.text === "/public");
  assert.ok(mount, "public router must be mounted from the actual server entry point");
  vm.runInNewContext(mount.getText(root), host.context);
  const http = await startRouter(host.context.apiRoutes); t.after(http.close);
  const request = async (action) => {
    const res = await fetch(`${http.url}/public/football-zigvy/attendance`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: "a", matchId: "a", action }) });
    assert.equal(res.status, 200);
  };
  await request("attending");
  await request("not_attending");
  assert.equal(host.slackCalls.length, 1);
  assert.equal(host.slackCalls[0].attachments[0].color, "danger");
  await request("attending");
  const queued = [...host.records].filter(([path]) => path.startsWith("slackQueue/")).map(([, data]) => data);
  assert.deepEqual(queued.map((data) => data.type), ["ATTEND", "CANCEL_NOT_ATTEND", "ATTEND"]);
  assert.ok(queued.every((data) => data.groupId === "football-zigvy" && data.memberName === "Football player"));
});
test("debtReminder groups by group and never includes Badminton in Football Slack", async (t) => {
  const host = setup(t);
  await host.job("debtReminder");
  assert.equal(host.slackCalls.length, 1);
  assert.ok(host.slackCalls[0].bodyMarkdown.includes("Football player"));
  assert.equal(host.slackCalls[0].bodyMarkdown.includes("Badminton player"), false);
  assert.equal(host.slackCalls[0].cta.url, "https://web.test/public/pay");
  assert.equal(groups.publicUrlFor("badm-1", "https://web.test/public"), "https://web.test/g/badm-1/public");
});
test("teams/propose and teams/lock reject non-football match 404", async (t) => {
  const host = setup(t);
  for (const path of ["/teams/propose", "/teams/lock"]) {
    const result = await host.call(path, { matchId: "b", token: "fake", passcode: "fake-passcode", teamsConfig: [{ id: "A", members: [] }] });
    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error, "NOT_FOUND");
  }
});
test("attendance and payment queue flushes keep groups separate and remove processed items", async (t) => {
  const host = setup(t, {
    "slackQueue/a": { matchId: "a", type: "ATTEND", memberName: "Football player", matchDateLabel: "Demo" },
    "slackQueue/b": { groupId: "badm-1", matchId: "b", type: "ATTEND", memberName: "Badminton player", matchDateLabel: "Demo" },
    "paymentQueue/a": { memberName: "Football player", totalPaid: 10000, affectedMatchIds: ["a"] },
    "paymentQueue/b": { groupId: "badm-1", memberName: "Badminton player", totalPaid: 90000, affectedMatchIds: ["b"] },
    "slackQueue/change-a": { matchId: "a", type: "NOT_ATTEND", memberName: "Football player", matchDateLabel: "Demo" },
    "slackQueue/change-b": { groupId: "badm-1", matchId: "b", type: "NOT_ATTEND", memberName: "Badminton player", matchDateLabel: "Demo" },
  });
  await host.job("flushAttendQueue");
  await host.job("flushPaymentQueue");
  await host.job("flushAttendanceChangeQueue");
  assert.equal(host.slackCalls.length, 3);
  assert.ok(host.slackCalls.every((payload) => !payload.bodyMarkdown.includes("Badminton player")));
  assert.equal([...host.records.keys()].some((path) => /^(slackQueue|paymentQueue)\//.test(path)), false);
});

test("closing and daily reminder jobs keep group Slack isolation and idempotent flags", async (t) => {
  for (const name of ["checkAttendanceClose", "dailyAttendanceReminder"]) {
    const date = Timestamp.fromMillis(Date.now() + 3 * 86400000);
    const host = setup(t, {
      "matches/a": { status: "PENDING", date },
      "matches/b": { groupId: "badm-1", status: "PENDING", date },
    });
    host.context.computeClosingTime = () => new Date(Date.now() + (name === "checkAttendanceClose" ? -60000 : 2 * 86400000));
    host.context.getTzOffsetMs = extract("getTzOffsetMs", host.context);
    host.context.startOfDayInTz = extract("startOfDayInTz", host.context);
    await host.job(name);
    assert.equal(host.slackCalls.length, 1, name);
    assert.ok(host.records.get("matches/a")[name === "checkAttendanceClose" ? "attendanceClosedNotified" : "lastDailyReminderDate"]);
    await host.job(name);
    assert.equal(host.slackCalls.length, 1, "retry must not repeat default group Slack");
  }
});

test("server imports Firestore sentinels without legacy namespace statics", () => {
  const declarations = root.statements.filter(ts.isVariableStatement);
  const imported = declarations.find((node) => node.getText(root).includes('require("firebase-admin/firestore")'));
  assert.ok(imported, "modular import required by Functions emulator worker");
  const sentinels = vm.runInNewContext(`${imported.getText(root)}; ({ FieldValue, Timestamp, FieldPath })`, {
    require(name) {
      assert.equal(name, "firebase-admin/firestore");
      return { FieldValue: { serverTimestamp: () => "sentinel" }, Timestamp, FieldPath: { documentId: () => "__name__" } };
    },
  });
  assert.equal(sentinels.FieldValue.serverTimestamp(), "sentinel");
  assert.equal(sentinels.Timestamp, Timestamp);
  assert.equal(sentinels.FieldPath.documentId(), "__name__");
  assert.doesNotMatch(source, /admin\.firestore\.(?:FieldValue|Timestamp|FieldPath)/);
});
