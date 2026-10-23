import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import groups from "../../server/lib/groups.js";
import { loadCjs } from "./load-cjs.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
function factory() { return loadCjs("../../server/lib/groupTargets.js", { "./groups": groups, "./slack": { PUBLIC_WEB_URL: "https://web.test/public" } }); }
test("group targets choose channel, default fallback, or skip; cache lasts one run", async () => {
  const fake = createFakeFirestore({ "groups/badm-1/settings/slack": { enabled: true, channelId: "C2222BBBB" } });
  const { createGroupTargets } = factory();
  const targets = createGroupTargets({ db: fake.db, env: { SLACK_BOT_TOKEN: "fake", SLACK_WEBHOOK_URL: "https://hook.test" } });
  assert.equal((await targets.getSlackTarget("badm-1")).channelId, "C2222BBBB");
  assert.equal((await targets.getSlackTarget("badm-1")).publicUrl, "https://web.test/g/badm-1/public");
  assert.equal((await targets.getSlackTarget("football-zigvy")).webhookUrl, "https://hook.test");
  assert.equal(await targets.getSlackTarget("missing-group"), null);
  const withoutBot = createGroupTargets({ db: fake.db, env: { SLACK_WEBHOOK_URL: "https://hook.test" } });
  assert.equal(await withoutBot.getSlackTarget("badm-1"), null);
  await fake.db.doc("groups/football-zigvy/settings/slack").set({ enabled: true, channelId: "C1111AAAA" });
  assert.equal((await targets.getSlackTarget("football-zigvy")).webhookUrl, "https://hook.test", "same run retains cached choice");
  assert.equal((await createGroupTargets({ db: fake.db, env: { SLACK_BOT_TOKEN: "fake" } }).getSlackTarget("football-zigvy")).channelId, "C1111AAAA");
});
test("Slack channel failure returns false without exposing fake token in logs", async () => {
  const logs = [], calls = [];
  const slack = loadCjs("../../server/lib/slack.js", {
    axios: { post: async (...args) => { calls.push(args); return { data: { ok: false, error: "not_in_channel" } }; } },
    "./slackConfig": { TIMEZONE: "Asia/Ho_Chi_Minh" }, "./mute": { isMuted: () => false },
  }, { process: { env: { SLACK_BOT_TOKEN: "fake-secret-sentinel" } }, console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  assert.equal(await slack.sendText("Fixture", { channelId: "C1111AAAA" }), false);
  assert.equal(calls[0][0], "https://slack.com/api/chat.postMessage");
  assert.equal(calls[0][1].channel, "C1111AAAA");
  assert.ok(!JSON.stringify(logs).includes("fake-secret-sentinel"));
});
test("actual debtReminder sends separate channel messages and group URLs", async () => {
  const fake = createFakeFirestore({
    "groups/football-zigvy/settings/slack": { enabled: true, channelId: "C1111AAAA" },
    "groups/badm-1/settings/slack": { enabled: true, channelId: "C2222BBBB" },
    "members/a": { name: "Football player" }, "members/b": { groupId: "badm-1", name: "Badminton player" },
    "matches/a": { status: "PUBLISHED", date: Timestamp.now() }, "matches/b": { groupId: "badm-1", status: "PUBLISHED", date: Timestamp.now() },
    "matches/a/shares/a": { memberId: "a", matchId: "a", status: "PENDING", amount: 10000 },
    "matches/b/shares/b": { groupId: "badm-1", memberId: "b", matchId: "b", status: "PENDING", amount: 20000 },
  });
  const calls = [];
  const slack = loadCjs("../../server/lib/slack.js", {
    axios: { post: async (...args) => { calls.push(args); return { data: { ok: true } }; } },
    "./slackConfig": { TIMEZONE: "Asia/Ho_Chi_Minh" }, "./mute": { isMuted: () => false },
  }, { process: { env: { SLACK_BOT_TOKEN: "fake-secret", SLACK_PUBLIC_WEB_URL: "https://web.test/public" } } });
  const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
  const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
  let code;
  const walk = (node) => {
    if (ts.isBinaryExpression(node) && node.left.getText(root) === "exports.debtReminder") code = node.right.arguments[1].getText(root);
    ts.forEachChild(node, walk);
  }; walk(root);
  const job = vm.runInNewContext(`(${code})`, {
    ...groups, ...factory(), FieldPath: { documentId: () => "__name__" }, admin: { firestore: Object.assign(() => fake.db, { FieldPath: { documentId: () => "__name__" } }) },
    process: { env: { SLACK_BOT_TOKEN: "fake-secret" } }, slack, console: { log() {}, error() {} },
    chunkArray: (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)),
  });
  await job();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call[1].channel).sort(), ["C1111AAAA", "C2222BBBB"]);
  const badminton = calls.find((call) => call[1].channel === "C2222BBBB")[1];
  assert.ok(JSON.stringify(badminton).includes("Badminton player"));
  assert.ok(!JSON.stringify(badminton).includes("Football player"));
  assert.ok(JSON.stringify(badminton).includes("https://web.test/g/badm-1/public/pay"));
});
test("all fourteen server Slack sites pass a resolved group target", () => {
  const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
  const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const walk = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(root) === "slack" && ["sendBlock", "postToSlack", "sendText"].includes(node.expression.name.text)) {
      count++; assert.equal(node.arguments[1]?.getText(root), "target");
    }
    ts.forEachChild(node, walk);
  }; walk(root);
  assert.equal(count, 14);
  assert.ok(!source.includes("if (groupId === DEFAULT_GROUP_ID)"));
});
