import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
async function setup(t, { duplicateEmail = false, failProvision = false } = {}) {
  const fake = createFakeFirestore({
    "platformAccounts/owner": { role: "owner", status: "active", email: "owner@test.local", createdAt: new Date(1) },
    "platformAccounts/user": { role: "user", status: "active", email: "user@test.local", createdAt: new Date(2) },
  });
  const identity = createFakeAuth({ users: [{ uid: "owner", email: "owner@test.local" }, { uid: "user", email: "user@test.local" }], duplicateEmail });
  const db = failProvision ? { ...fake.db, collection(name) {
    const collection = fake.db.collection(name);
    return { ...collection, doc(uid) { const ref = collection.doc(uid); return uid.startsWith("fake-") ? { ...ref, set: async () => { throw new Error("DB failure"); } } : ref; } };
  } } : fake.db;
  const { createPlatformRouter } = loadCjs("../../server/lib/platformRoutes.js", { "./auth": loadCjs("../../server/lib/auth.js"), "./groups": loadCjs("../../server/lib/groups.js") });
  const host = await startRouter(createPlatformRouter({ db, auth: identity.auth, FieldValue: fake.FieldValue })); t.after(host.close);
  return { ...fake, identity, async request(method, path, body, uid = "owner") {
    const res = await fetch(host.url + path, { method, headers: { Authorization: `Bearer uid:${uid}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: res.status === 204 ? null : await res.json() };
  } };
}
const form = { email: "new@test.local", displayName: "Demo user", password: "fake-password-123" };
test("owner creates accounts; password stays out of db, responses and call log", async (t) => {
  const host = await setup(t);
  assert.equal((await host.request("POST", "/accounts", form, "user")).status, 403);
  const result = await host.request("POST", "/accounts", form);
  assert.equal(result.status, 201);
  assert.equal(result.data.email, form.email);
  assert.equal(host.records.get(`platformAccounts/${result.data.uid}`).createdBy, "owner");
  for (const data of [Object.fromEntries(host.records), result.data, host.identity.log]) assert.ok(!JSON.stringify(data).includes(form.password));
  assert.equal((await host.request("GET", "/me", null, "user")).data.uid, "user");
  const list = await host.request("GET", "/accounts");
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 3);
});
test("invalid input and duplicate emails are rejected", async (t) => {
  const host = await setup(t);
  for (const bad of [{ email: "invalid" }, { password: "short" }, { displayName: "" }, { password: "a".repeat(129) }]) assert.equal((await host.request("POST", "/accounts", { ...form, ...bad })).status, 400);
  const duplicate = await setup(t, { duplicateEmail: true });
  assert.equal((await duplicate.request("POST", "/accounts", form)).status, 409);
});
test("Firestore provisioning failure compensates by removing newly created Auth user", async (t) => {
  const host = await setup(t, { failProvision: true });
  const result = await host.request("POST", "/accounts", form);
  assert.equal(result.status, 500);
  assert.equal(result.data.error, "PROVISION_FAILED");
  assert.equal(host.identity.records.has("fake-1"), false);
  assert.equal(host.identity.log.at(-1).method, "deleteUser");
});
test("disable and password reset revoke tokens; owner cannot be disabled", async (t) => {
  const host = await setup(t);
  assert.equal((await host.request("PATCH", "/accounts/owner", { status: "disabled" })).status, 409);
  assert.equal((await host.request("PATCH", "/accounts/owner", { displayName: "Owner rename" })).status, 200);
  assert.equal((await host.request("PATCH", "/accounts/user", { status: "disabled" })).status, 200);
  assert.equal((await host.request("GET", "/me", null, "user")).status, 403);
  assert.equal((await host.request("POST", "/accounts/user/password", { password: form.password })).status, 204);
  assert.equal(host.identity.log.filter((entry) => entry.method === "revokeRefreshTokens").length, 2);
  assert.equal(host.identity.records.get("user").disabled, undefined);
});
