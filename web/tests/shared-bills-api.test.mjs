import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { startRouter } from "./http-harness.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const { createBillRouter } = require("../../server/lib/billRoutes.js");

test("bill API denies anonymous/foreign/admin users and completes owner confirmation", async (t) => {
  const fake = createFakeFirestore({
    "groups/netflix": { kind: "shared_bills", status: "active", ownerUid: "manager" },
    "groupMembers/netflix_admin": { role: "admin", tabs: ["members"] },
    "members/a": { name: "Owner", groupId: "netflix" }, "members/b": { name: "Friend", groupId: "netflix" },
  });
  const host = await startRouter(createBillRouter({ ...fake, auth: createFakeAuth().auth }));
  t.after(host.close);
  const request = async (method, path, body, uid) => {
    const res = await fetch(host.url + path, { method, headers: { "Content-Type": "application/json", ...(uid ? { Authorization: `Bearer uid:${uid}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await request("GET", "/netflix/bills")).status, 401);
  assert.equal((await request("GET", "/netflix/bills", null, "stranger")).status, 403);
  assert.equal((await request("GET", "/netflix/bills", null, "admin")).status, 403);
  const input = { title: "Netflix", amountVnd: 260000, participantIds: ["a", "b"], providerPayerMemberId: "a", billingDate: "2026-11-01", dueDate: "2026-11-05", requestId: "bill-one" };
  const created = await request("POST", "/netflix/bills", input, "manager");
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await request("GET", `/netflix/bills/${id}`, null, "manager")).body.summary.outstanding, 130000);
  assert.equal((await request("POST", `/netflix/bills/${id}/payments`, { memberId: "b", requestId: "pay-one", action: "confirm" }, "manager")).status, 200);
  assert.equal((await request("GET", `/netflix/bills/${id}`, null, "manager")).body.state, "closed");
});
