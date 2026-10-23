import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";

const require = createRequire(import.meta.url);
const groups = require("../../server/lib/groups.js");

test("Group v4: custom slug, ownership, co-managers, and deletion", async (t) => {
  const fake = createFakeFirestore({
    "platformAccounts/owner": { role: "owner", status: "active", email: "owner@test.local", displayName: "Super Admin" },
    "platformAccounts/user-a": { role: "user", status: "active", email: "a@test.local", displayName: "User A" },
    "platformAccounts/user-b": { role: "user", status: "active", email: "b@test.local", displayName: "User B" },
  });

  const { createPlatformRouter } = loadCjs("../../server/lib/platformRoutes.js", {
    "./auth": loadCjs("../../server/lib/auth.js"),
    "./groups": groups,
    "node:crypto": { randomInt: () => 0 },
  });

  const fakeAuth = createFakeAuth({
    users: [
      { uid: "owner", email: "owner@test.local" },
      { uid: "user-a", email: "a@test.local" },
      { uid: "user-b", email: "b@test.local" },
    ],
  });

  const host = await startRouter(
    createPlatformRouter({ db: fake.db, auth: fakeAuth.auth, FieldValue: fake.FieldValue })
  );
  t.after(host.close);

  async function request(method, path, body, uid = "user-a") {
    const res = await fetch(host.url + path, {
      method,
      headers: {
        Authorization: `Bearer uid:${uid}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = res.status !== 204 ? await res.json().catch(() => null) : null;
    return { status: res.status, data };
  }

  // 1. User A creates group with custom slug
  const createRes = await request("POST", "/groups", { name: "Cầu Lông Quận 1", sport: "badminton", id: "cau-long-q1" }, "user-a");
  assert.equal(createRes.status, 201);
  assert.equal(createRes.data.id, "cau-long-q1");

  // Verify group document in DB
  const groupDoc = fake.records.get("groups/cau-long-q1");
  assert.ok(groupDoc);
  assert.equal(groupDoc.ownerUid, "user-a");
  assert.equal(groupDoc.ownerEmail, "a@test.local");

  // 2. Duplicate slug should return 409
  const dupRes = await request("POST", "/groups", { name: "Cầu Lông Khác", sport: "badminton", id: "cau-long-q1" }, "user-b");
  assert.equal(dupRes.status, 409);
  assert.equal(dupRes.data.error, "GROUP_ID_EXISTS");

  // 3. User B creates their own group with auto slug
  const bRes = await request("POST", "/groups", { name: "Pickleball Thủ Đức", sport: "pickleball" }, "user-b");
  assert.equal(bRes.status, 201);
  const bGroupId = bRes.data.id;
  assert.ok(bGroupId.startsWith("pickleball-thu-duc-"));

  // 4. Test Isolation: User A only sees User A's group
  const listA = await request("GET", "/groups", null, "user-a");
  assert.equal(listA.status, 200);
  assert.equal(listA.data.length, 1);
  assert.equal(listA.data[0].id, "cau-long-q1");
  assert.equal(listA.data[0].ownerEmail, "a@test.local");

  // 5. Test Super Admin: sees ALL groups
  const listSuper = await request("GET", "/groups", null, "owner");
  assert.equal(listSuper.status, 200);
  assert.equal(listSuper.data.length, 2);

  // 6. User A assigns User B as Co-manager of cau-long-q1
  const assignRes = await request("POST", "/groups/cau-long-q1/co-managers", { email: "b@test.local", role: "manager" }, "user-a");
  assert.equal(assignRes.status, 201);
  assert.equal(assignRes.data.uid, "user-b");

  // User B now sees cau-long-q1 as well
  const listBAfterAssign = await request("GET", "/groups", null, "user-b");
  assert.equal(listBAfterAssign.data.length, 2);

  // 7. Safe Delete: User A deletes cau-long-q1
  const delRes = await request("DELETE", "/groups/cau-long-q1", null, "user-a");
  assert.equal(delRes.status, 200);
  assert.equal(fake.records.get("groups/cau-long-q1").status, "deleted");

  // After deletion, it no longer appears in GET /groups
  const listAAfterDel = await request("GET", "/groups", null, "user-a");
  assert.equal(listAAfterDel.data.length, 0);
});
