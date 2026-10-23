import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import { loadCjs } from "./load-cjs.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { startRouter } from "./http-harness.mjs";
import groups from "../../server/lib/groups.js";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const source = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
const root = ts.createSourceFile("index.js", source, ts.ScriptTarget.Latest, true);
const paths = ["/send-match-notification", "/notify/attendance-created", "/notify/attendance-deleted", "/notify/match-published", "/notify/manual"];
function declaration(name, context) {
  const node = root.statements.filter(ts.isVariableStatement).flatMap((statement) => [...statement.declarationList.declarations]).find((node) => node.name.getText(root) === name);
  assert.ok(node, `missing ${name}`);
  return vm.runInNewContext(`(${node.initializer.getText(root)})`, context);
}
const routes = root.statements.filter(ts.isExpressionStatement).map((node) => node.expression).filter((node) => ts.isCallExpression(node) && node.expression.getText(root) === "apiRoutes.post");
async function setup(t) {
  const fake = createFakeFirestore({
    "platformAccounts/owner": { role: "owner", status: "active" },
    "platformAccounts/disabled": { role: "owner", status: "disabled" },
    "groupMembers/alpha_manager": { role: "manager" },
    "groupMembers/alpha_admin": { role: "admin", tabs: [] },
    "groupMembers/beta_other": { role: "manager" },
    "groupMembers/alpha_disabled": { role: "manager" },
    "userRoles/legacy": { roles: ["superadmin"] },
    "matches/a": { groupId: "alpha" }, "matches/b": { groupId: "beta" },
  });
  const identity = createFakeAuth();
  const context = { ...groups, ...loadCjs("../../server/lib/auth.js"), admin: { firestore: () => fake.db, auth: () => identity.auth } };
  context.triggerAuth = declaration("triggerAuth", context);
  context.requireTriggerStaff = declaration("requireTriggerStaff", context);
  const router = require("express").Router();
  const calls = [];
  for (const path of paths) {
    const route = routes.find((node) => node.arguments[0].text === path);
    assert.ok(route, path);
    const middleware = route.arguments.slice(1, -1).map((node) => vm.runInNewContext(node.getText(root), context));
    router.post(path, ...middleware, (req, res) => { calls.push({ path, uid: req.uid, groupId: req.groupId }); res.json({ ok: true }); });
  }
  const host = await startRouter(router); t.after(host.close);
  return { calls, async request(path, uid, body = {}) {
    const response = await fetch(host.url + path, { method: "POST", headers: { "Content-Type": "application/json", ...(uid ? { Authorization: `Bearer uid:${uid}` } : {}) },
      body: JSON.stringify({ groupId: "alpha", matchId: "a", title: "Fixture", body: "Fixture", ...body }) });
    return { status: response.status, data: await response.json() };
  } };
}
test("all five admin triggers deny missing tokens and foreign or disabled staff before side effects", async (t) => {
  const host = await setup(t);
  for (const path of paths) {
    assert.equal((await host.request(path)).status, 401, path);
    for (const uid of ["other", "disabled", "legacy"]) assert.equal((await host.request(path, uid)).status, 403, `${path} ${uid}`);
  }
  assert.equal(host.calls.length, 0);
});
test("staff of the stored match group, including admin and owner, can trigger notifications", async (t) => {
  const host = await setup(t);
  for (const path of paths) for (const uid of ["manager", "admin", "owner"]) {
    assert.equal((await host.request(path, uid)).status, 200, `${path} ${uid}`);
    assert.equal(host.calls.at(-1).groupId, "alpha");
  }
  assert.equal(host.calls.length, 15);
});
test("match group cannot be spoofed; manual group comes from its body", async (t) => {
  const host = await setup(t);
  for (const path of paths.filter((path) => path !== "/notify/manual")) {
    assert.equal((await host.request(path, "manager", { matchId: "b" })).status, 403);
    assert.equal((await host.request(path, "manager", { matchId: "missing" })).status, 404);
    assert.equal((await host.request(path, "manager", { matchId: "a/b" })).status, 400);
  }
  assert.equal((await host.request("/notify/manual", "manager", { groupId: "beta" })).status, 403);
  assert.equal((await host.request("/notify/manual", "other", { groupId: "beta" })).status, 200);
  assert.equal(host.calls.at(-1).groupId, "beta");
});
test("planned public endpoints keep their existing unauthenticated route handlers", () => {
  for (const path of ["/create-payment-link", "/payos-webhook", "/teams/propose", "/teams/lock", "/notify/member-action"]) {
    const route = routes.find((node) => node.arguments[0].text === path);
    assert.ok(route, path);
    assert.equal(route.arguments.length, 2, `${path} must remain public`);
  }
  assert.ok(source.includes('apiRoutes.use("/public", createPublicRouter('));
});
