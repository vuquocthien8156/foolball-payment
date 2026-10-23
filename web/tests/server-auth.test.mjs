import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { loadSource } from "./helpers.mjs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const express = require("express");
test("server auth rejects forged, disabled, legacy and wrong-group identities", async (t) => {
  const { createAuthMiddleware } = loadCjs("../../server/lib/auth.js");
  const fake = createFakeFirestore({
    "platformAccounts/owner": { role: "owner", status: "active" },
    "platformAccounts/user": { role: "user", status: "active" },
    "platformAccounts/disabled": { role: "owner", status: "disabled" },
    "groupMembers/alpha_manager": { role: "manager", tabs: [] },
    "groupMembers/alpha_admin": { role: "admin", tabs: ["members"] },
    "groupMembers/alpha_disabled": { role: "manager", tabs: [] },
    "groupMembers/football-zigvy_migrated": { role: "manager", tabs: [] },
    "userRoles/legacy": { roles: ["superadmin"] },
  });
  const mw = createAuthMiddleware({ db: fake.db, auth: createFakeAuth().auth });
  const router = express.Router();
  router.get("/platform", mw.requireUser, mw.requirePlatform, (_, res) => res.json({ ok: true }));
  router.get("/owner", mw.requireUser, mw.requireOwner, (_, res) => res.json({ ok: true }));
  router.get("/groups/:groupId/manager", mw.requireUser, mw.requireGroupRole({ manager: true }), (_, res) => res.json({ ok: true }));
  router.get("/groups/:groupId/members", mw.requireUser, mw.requireGroupRole({ tab: "members" }), (_, res) => res.json({ ok: true }));
  const host = await startRouter(router); t.after(host.close);
  const status = async (path, uid, raw = false) => (await fetch(host.url + path, { headers: uid ? { Authorization: raw ? uid : `Bearer uid:${uid}` } : {} })).status;
  assert.equal(await status("/platform"), 401);
  assert.equal(await status("/platform", "Bearer invalid", true), 401);
  assert.equal(await status("/platform", "unknown"), 403);
  assert.equal(await status("/platform", "disabled"), 403);
  assert.equal(await status("/owner", "owner"), 200);
  assert.equal(await status("/owner", "user"), 403);
  assert.equal(await status("/groups/alpha/manager", "manager"), 200);
  assert.equal(await status("/groups/alpha/members", "admin"), 200);
  assert.equal(await status("/groups/alpha/manager", "admin"), 403);
  assert.equal(await status("/groups/beta/members", "admin"), 403);
  assert.equal(await status("/groups/football-zigvy/manager", "legacy"), 403);
  assert.equal(await status("/groups/football-zigvy/manager", "migrated"), 200);
  assert.equal(await status("/groups/alpha/manager", "disabled"), 403);
  assert.equal(await status("/groups/alpha/manager", "owner"), 200);
});
test("api client attaches current identity, handles JSON errors and signed-out requests", async () => {
  const calls = [];
  let currentUser = { getIdToken: async () => "fake-token" };
  let ok = true;
  const { exports: api } = loadSource("../src/lib/api.ts", { "@/lib/firebase": { auth: { get currentUser() { return currentUser; } } } }, {
    fetch: async (url, options) => { calls.push({ url, ...options }); return { ok, headers: { get: () => "application/json" }, json: async () => ok ? { success: true } : { error: "DENIED" } }; },
  });
  await api.postApiJson("/test", { groupId: "alpha" });
  assert.equal(calls[0].headers.Authorization, "Bearer fake-token");
  assert.equal(calls[0].method, "POST");
  currentUser = null;
  await api.apiRequest("GET", "/test");
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls[1].body, undefined);
  ok = false;
  await assert.rejects(() => api.apiRequest("GET", "/test"), /DENIED/);
});
