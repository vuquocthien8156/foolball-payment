import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const groups = require("../../server/lib/groups.js");
async function setup(t, { suffixes = ["aaaa"], extra = {}, failMembership = false } = {}) {
  const fake = createFakeFirestore({
    "platformAccounts/owner": { role: "owner", status: "active" }, "platformAccounts/user": { role: "user", status: "active" },
    "groups/alpha": { name: "Alpha", sport: "football", status: "active" }, "groups/beta": { name: "Beta", sport: "badminton", status: "active" },
    "groupMembers/alpha_staff": { uid: "staff", groupId: "alpha", role: "manager" },
    "groupMembers/alpha_user": { uid: "user", groupId: "alpha", role: "manager" }, ...extra,
  });
  const chars = suffixes.join("").split("");
  const db = failMembership ? { ...fake.db, runTransaction: (fn) => fake.db.runTransaction((tx) => fn({ ...tx, set(ref, data) { if (ref.path.startsWith("groupMembers/")) throw new Error("Failure"); return tx.set(ref, data); } })) } : fake.db;
  const { createPlatformRouter } = loadCjs("../../server/lib/platformRoutes.js", {
    "./auth": loadCjs("../../server/lib/auth.js"), "./groups": groups,
    "node:crypto": { randomInt: () => parseInt(chars.shift() || "a", 36) },
  });
  const host = await startRouter(createPlatformRouter({ db, auth: createFakeAuth().auth, FieldValue: fake.FieldValue })); t.after(host.close);
  return { ...fake, async request(method, path, body, uid = "user") {
    const res = await fetch(host.url + path, { method, headers: { Authorization: `Bearer uid:${uid}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json() };
  } };
}
test("user lists own groups; owner lists all", async (t) => {
  const host = await setup(t);
  assert.deepEqual((await host.request("GET", "/groups")).data.map((group) => group.id), ["alpha"]);
  assert.deepEqual((await host.request("GET", "/groups", null, "owner")).data.map((group) => group.id), ["alpha", "beta"]);
});
test("create validates sport and atomically creates manager with empty group", async (t) => {
  const host = await setup(t);
  for (const sport of [undefined, "tennis"]) assert.equal((await host.request("POST", "/groups", { name: "New group", sport })).status, 400);
  assert.equal((await host.request("POST", "/groups", { name: " ", sport: "other" })).status, 400);
  const created = await host.request("POST", "/groups", { name: " Cầu lông ", sport: "badminton" });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, "cau-long-aaaa");
  assert.equal(host.records.get(`groups/${created.data.id}`).sport, "badminton");
  assert.equal(host.records.get(`groups/${created.data.id}`).ownerUid, "user");
  assert.equal(host.records.get(`groupMembers/${created.data.id}_user`).role, "manager");
  assert.equal([...host.records.keys()].filter((path) => /^(members|matches)\//.test(path)).length, 0);
  const failed = await setup(t, { failMembership: true });
  assert.equal((await failed.request("POST", "/groups", { name: "New", sport: "other" })).status, 500);
  assert.equal(failed.records.has("groups/new-aaaa"), false);
});
test("ID collisions retry up to five then return 503", async (t) => {
  const extra = { "groups/new-aaaa": { name: "Existing" } };
  const host = await setup(t, { suffixes: ["aaaa", "bbbb"], extra });
  assert.equal((await host.request("POST", "/groups", { name: "New", sport: "other" })).data.id, "new-bbbb");
  const exhausted = await setup(t, { extra });
  assert.equal((await exhausted.request("POST", "/groups", { name: "New", sport: "other" })).status, 503);
});
test("manager renames own group; owner alone changes sport and status", async (t) => {
  const host = await setup(t);
  assert.equal((await host.request("PATCH", "/groups/alpha", { name: "Renamed" })).status, 200);
  assert.equal((await host.request("PATCH", "/groups/alpha", { name: "Staff rename" }, "staff")).status, 200);
  assert.equal((await host.request("PATCH", "/groups/beta", { name: "Denied" })).status, 403);
  assert.equal((await host.request("PATCH", "/groups/alpha", { sport: "other" })).status, 403);
  assert.equal((await host.request("PATCH", "/groups/alpha", { status: "archived" })).status, 403);
  assert.equal((await host.request("PATCH", "/groups/alpha", { sport: "badminton" }, "owner")).status, 200);
  assert.equal(host.records.get("groups/alpha").sport, "badminton");
  assert.equal((await host.request("PATCH", "/groups/alpha", { sport: "invalid" }, "owner")).status, 400);
});
