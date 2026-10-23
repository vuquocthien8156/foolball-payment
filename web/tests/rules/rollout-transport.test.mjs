import assert from "node:assert/strict";
import { before, test } from "node:test";
import rollout from "../../../server/scripts/gcloud-firestore.js";
import migration from "../../../server/scripts/migrate-default-group.js";
import ownerSeed from "../../../server/scripts/seed-owner.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Local emulator required");
const databaseId = "rollout-transport";
const requests = [];
const db = rollout.createRestFirestore({ projectId: "demo-football", databaseId, request: async ({ method, url, body }) => {
  requests.push({ method, url, body });
  const parsed = new URL(url);
  const response = await fetch(`http://${host}${parsed.pathname}${parsed.search}`, { method,
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
} });
before(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/demo-football/databases/${databaseId}/documents`, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
  assert.equal(response.ok, true);
});
test("rollout REST writes preserve fields, server timestamps and raw Firestore timestamp precision", async () => {
  await db.doc("platformAccounts/fixture").set({ role: "user", nested: { values: [1, 1.5, true, null] }, createdAt: rollout.FieldValue.serverTimestamp() });
  const first = (await db.doc("platformAccounts/fixture").get()).data();
  assert.equal(first.role, "user"); assert.ok(first.createdAt);
  await db.doc("platformAccounts/fixture").set({ displayName: "Updated", createdAt: first.createdAt }, { merge: true });
  const updated = (await db.doc("platformAccounts/fixture").get()).data();
  assert.equal(updated.role, "user");
  assert.deepEqual(updated.nested, { values: [1, 1.5, true, null] });
  assert.deepEqual(updated.createdAt, first.createdAt);
});
test("existing migration and seed run on REST transport, preserve data, and migration repeats with zero writes", async () => {
  const initial = db.batch();
  initial.set(db.doc("members/player"), { name: "Original", authUid: "owner", inactive: false });
  initial.set(db.doc("matches/match"), { status: "PENDING", totalAmount: 100 });
  initial.set(db.doc("matches/match/shares/share"), { amount: 100, memberId: "player" });
  initial.set(db.doc("userRoles/owner"), { roles: ["superadmin"] });
  initial.set(db.doc("configs/last_match"), { note: "Kept", date: new Date("2026-10-22T00:00:00.123Z") });
  await initial.commit();
  const args = { ownerUid: "owner", apply: false };
  const dry = await migration.run({ db, FieldValue: rollout.FieldValue, args, log() {} });
  assert.equal(dry.written, 0); assert.ok(dry.proposed > 0);
  assert.equal((await db.doc("groups/football-zigvy").get()).exists, false);
  const applied = await migration.run({ db, FieldValue: rollout.FieldValue, args: { ...args, apply: true }, log() {} });
  assert.equal(applied.written, dry.proposed);
  assert.equal((await db.doc("members/player").get()).data().groupId, "football-zigvy");
  const rawMember = await fetch(`http://${host}/v1/projects/demo-football/databases/${databaseId}/documents/members/player`, { headers: { Authorization: "Bearer owner" } }).then((response) => response.json());
  assert.equal(rawMember.fields.name.stringValue, "Original");
  assert.equal(rawMember.fields.inactive.booleanValue, false);
  assert.equal((await db.doc("groups/football-zigvy").get()).data().ownerUid, "owner");
  assert.equal((await db.doc("groupMembers/football-zigvy_owner").get()).data().role, "manager");
  assert.deepEqual((await db.doc("groups/football-zigvy/settings/lastMatch").get()).data(), (await db.doc("configs/last_match").get()).data());
  assert.equal((await migration.run({ db, FieldValue: rollout.FieldValue, args: { ...args, apply: true }, log() {} })).written, 0);
  await ownerSeed.run({ db, args: { uid: "owner", email: "owner@test.local", apply: true }, log() {} });
  assert.equal((await db.doc("platformAccounts/owner").get()).data().role, "owner");
  const memberRequest = requests.find((entry) => entry.url.endsWith(":runQuery") && entry.body.structuredQuery.from[0].collectionId === "members");
  assert.deepEqual(memberRequest.body.structuredQuery.select.fields, [{ fieldPath: "groupId" }, { fieldPath: "authUid" }]);
});
test("rollout projections do not fetch notification payloads or member tokens", async () => {
  await db.doc("notificationTokens/disposable-fixture").set({ token: "not-a-real-token", groupId: "football-zigvy" });
  const snapshot = await db.collection("notificationTokens").get();
  assert.equal(snapshot.docs[0].data().token, undefined);
  assert.equal(snapshot.docs[0].data().groupId, "football-zigvy");
  assert.throws(() => rollout.createRestFirestore({ projectId: "another-project" }), /Unexpected/);
});
