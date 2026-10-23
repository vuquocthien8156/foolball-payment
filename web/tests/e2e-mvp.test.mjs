import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import groups from "../../server/lib/groups.js";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
import { loadSource, mountPage } from "./helpers.mjs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const express = require("express");
const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
function extract(name, context) {
  let code;
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.arguments[0]?.text === name) code = node.arguments.at(-1).getText(root);
    if (ts.isVariableDeclaration(node) && node.name.getText(root) === name) code = node.initializer.getText(root);
    if (ts.isBinaryExpression(node) && node.left.getText(root) === `exports.${name}`) code = node.right.arguments.at(-1).getText(root);
    ts.forEachChild(node, walk);
  }; walk(root);
  assert.ok(code, name);
  return vm.runInNewContext(`(${code})`, context);
}
for (const configured of [true, false]) test(`MVP owner to group payment flow; Slack ${configured ? "configured" : "off"}`, async (t) => {
  const football = {
    "groups/football-zigvy": { name: "Football", sport: "football", status: "active" },
    "members/football": { name: "Football", groupId: "football-zigvy", fcmToken: "fake-football" },
    "matches/football": { groupId: "football-zigvy", status: "PUBLISHED", totalAmount: 100 },
    "matches/football/shares/old": { groupId: "football-zigvy", memberId: "football", amount: 100, status: "PAID" },
  };
  const fake = createFakeFirestore(football);
  await loadCjs("../../server/scripts/seed-owner.js").run({ db: fake.db, args: { uid: "owner", email: "owner@test.local", apply: true }, log() {} });
  const identity = createFakeAuth();
  const slackCalls = [], pushes = [], checkouts = [];
  const env = { SLACK_BOT_TOKEN: "xoxb-test", SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/TEST", PAYOS_RETURN_URL: "https://web.test/public/payment-success", PAYOS_CANCEL_URL: "https://web.test/public/payment-cancel" };
  const slack = loadCjs("../../server/lib/slack.js", {
    axios: { post: async (...args) => { slackCalls.push(args); return { data: { ok: true } }; } },
    "./slackConfig": { TIMEZONE: "Asia/Ho_Chi_Minh" }, "./mute": { isMuted: () => false },
  }, { process: { env: { ...env, SLACK_PUBLIC_WEB_URL: "https://web.test/public" } } });
  const { createGroupTargets } = loadCjs("../../server/lib/groupTargets.js", { "./groups": groups, "./slack": slack });
  const context = { ...groups, createGroupTargets, FieldValue: fake.FieldValue, Timestamp, URL, Date, Set, Map, slack,
    admin: { firestore: Object.assign(() => fake.db, { FieldPath: { documentId: () => "__name__" } }) },
    process: { env }, isMuted: () => false, console: { log() {}, error() {} },
    payos: { paymentRequests: { create: async (body) => { checkouts.push(body); return { checkoutUrl: "https://checkout.test/mock" }; } }, webhooks: { verify: async (body) => body } },
    chunkArray: (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)),
    sendPushToTokens: async (tokens) => { pushes.push([...tokens]); return { successCount: tokens.length, failureCount: 0 }; },
  };
  context.collectGroupTokens = extract("collectGroupTokens", context);
  const router = express.Router();
  const { createPlatformRouter } = loadCjs("../../server/lib/platformRoutes.js", { "./auth": loadCjs("../../server/lib/auth.js"), "./groups": groups, "node:crypto": { randomInt: () => 0 } });
  router.use("/platform", createPlatformRouter({ db: fake.db, auth: identity.auth, FieldValue: fake.FieldValue }));
  router.post("/create-payment-link", extract("/create-payment-link", context));
  Object.assign(context, loadCjs("../../server/lib/auth.js"));
  context.admin.auth = () => identity.auth;
  context.triggerAuth = extract("triggerAuth", context);
  context.requireTriggerStaff = extract("requireTriggerStaff", context);
  context.apiRoutes = router;
  const publishRoute = root.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(root) === "apiRoutes.post" && node.expression.arguments[0]?.text === "/notify/match-published");
  assert.ok(publishRoute);
  vm.runInNewContext(publishRoute.getText(root), context);
  router.post("/payos-webhook", extract("payosWebhookHandler", context));
  const server = await startRouter(router); t.after(server.close);
  const request = async (path, body, uid = "owner") => {
    const res = await fetch(server.url + path, { method: "POST", headers: { Authorization: `Bearer uid:${uid}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json(); assert.ok(res.ok, `${path}: ${JSON.stringify(data)}`); return data;
  };
  const account = await request("/platform/accounts", { email: "new@test.local", displayName: "New manager", password: "fake-password-only" });
  const { id: gid } = await request("/platform/groups", { name: "Cầu lông", sport: "badminton" }, account.uid);
  assert.equal(fake.records.get(`groupMembers/${gid}_${account.uid}`).role, "manager");
  const clientGroups = loadSource("../src/lib/groups.ts").exports;
  const shared = { "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid }), useGroupPath: () => (sub) => clientGroups.groupPath(gid, sub) },
    "@/lib/groups": clientGroups, "@/lib/utils": loadSource("../src/lib/utils.ts").exports, "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore };
  const members = mountPage("Members", { isLoading: false }, { ...shared, "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) } });
  for (const name of ["One", "Two", "Three"]) { members.states.set("newMemberName", name); members.render(); await members.page.handleAddMember(); }
  const players = [...fake.records].filter(([path, data]) => path.startsWith("members/") && data.groupId === gid).map(([path, data]) => ({ id: path.split("/")[1], name: data.name }));
  assert.equal(players.length, 3);
  for (const player of players) await fake.db.doc(`notificationTokens/${player.id}`).set({ token: `fake-${player.id}`, groupId: gid });
  if (configured) await fake.db.doc(`groups/${gid}/settings/slack`).set({ enabled: true, channelId: "C0TEST0001" });
  const notifications = [];
  const setup = mountPage("SetupMatch", { isLoading: false, date: "2026-10-22", time: "19:00", teamCount: 2,
    teams: [{ id: "A", name: "A", percent: 50, members: players.slice(0, 1) }, { id: "B", name: "B", percent: 50, members: players.slice(1) }],
    expenseItems: [{ id: "court", description: "Court", amount: 60000, type: "SHARED", exemptMemberIds: [], teamPercents: { A: 50, B: 50 } }],
  }, { ...shared, "react-router-dom": { useParams: () => ({}), useNavigate: () => () => {} }, "@/hooks/use-toast": { toast() {} },
    "@/lib/api": { postApiJson: (path, body) => { const pending = request(path, body, account.uid); notifications.push(pending); return pending; } },
  }, { window: { location: { origin: "https://web.test" } }, navigator: { clipboard: { writeText: async () => {} } } });
  await setup.page.handleSave(true);
  await Promise.all(notifications);
  const match = [...fake.records].find(([path, data]) => /^matches\/[^/]+$/.test(path) && data.groupId === gid);
  assert.ok(match); assert.equal(match[1].status, "PUBLISHED");
  assert.equal(pushes.length, 1); assert.equal(pushes[0].length, 3); assert.ok(!pushes[0].includes("fake-football"));
  const sharePaths = [...fake.records.keys()].filter((path) => path.startsWith(`${match[0]}/shares/`));
  assert.equal(sharePaths.length, 3);
  await request("/create-payment-link", { groupId: gid, memberId: players[0].id, memberIds: players.map((player) => player.id), sharePaths, ratings: [] }, account.uid);
  assert.equal(checkouts[0].amount, 60000);
  await request("/payos-webhook", { code: "00", orderCode: checkouts[0].orderCode, amount: 60000 });
  assert.ok(sharePaths.every((path) => fake.records.get(path).status === "PAID"));
  for (const [path, data] of fake.records) if (path.startsWith("notifications/") || path.startsWith("paymentQueue/")) assert.equal(data.groupId, gid);
  slackCalls.length = 0;
  await extract("flushPaymentQueue", context)();
  assert.equal(slackCalls.length, configured ? 2 : 0);
  assert.ok(slackCalls.every((call) => call[0] === "https://slack.com/api/chat.postMessage" && call[1].channel === "C0TEST0001"));
  for (const [path, data] of Object.entries(football)) assert.deepEqual(fake.records.get(path), data);
});
