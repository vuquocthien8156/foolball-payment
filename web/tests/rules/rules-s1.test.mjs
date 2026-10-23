import assert from "node:assert/strict";
import { before, test } from "node:test";
import { seed, get, write, query } from "./emulator-client.mjs";
before(async () => {
  for (const [path, data] of Object.entries({
    "platformAccounts/alice": { role: "owner", status: "active" },
    "platformAccounts/bob": { role: "user", status: "active" },
    "groupSecrets/a": { reserved: true }, "groups/alpha": { name: "Alpha" },
    "groupMembers/alpha_alice": { uid: "alice", groupId: "alpha", role: "manager" },
    "groupMembers/alpha_bob": { uid: "bob", groupId: "alpha", role: "admin" },
    "matches/m/shares/s": { groupId: "alpha", amount: 100 },
    "matches/m/ratings/r": { groupId: "alpha", score: 5 },
    "matches/m/adminRatings/r": { score: 5 }, "matches/m/liveEvents/e": { type: "goal" },
  })) assert.equal((await seed(path, data)).ok, true, path);
});
test("anon and user cannot create platform owner records", async () => {
  assert.equal((await write("platformAccounts/anon", { role: "owner" })).status, 403);
  assert.equal((await write("platformAccounts/bob", { role: "owner" }, "bob")).status, 403);
});
test("platform accounts readable only by their own UID", async () => {
  assert.equal((await get("platformAccounts/alice", "alice")).ok, true);
  assert.equal((await get("platformAccounts/bob", "alice")).status, 403);
  assert.equal((await get("platformAccounts/alice")).status, 403);
});
test("groupSecrets unreadable even by owner client", async () => {
  assert.equal((await get("groupSecrets/a", "alice")).status, 403);
});
test("groups public read and server-only writes", async () => {
  assert.equal((await get("groups/alpha")).ok, true);
  assert.equal((await write("groups/alpha", { name: "Changed" }, "alice")).status, 403);
});
test("own membership including missing document readable; other membership denied", async () => {
  assert.equal((await get("groupMembers/alpha_alice", "alice")).ok, true);
  assert.equal((await get("groupMembers/missing_alice", "alice")).status, 404);
  assert.equal((await get("groupMembers/alpha_bob", "alice")).status, 403);
  assert.equal((await query("groupMembers", [["uid", "EQUAL", "alice"]], { uid: "alice" })).ok, true);
});
test("S3 supersedes S1 open member writes while preserving public reads", async () => {
  assert.equal((await seed("members/legacy", { name: "Fixture", count: 1, enabled: true, tags: ["a"], nested: { optional: null }, date: new Date() })).ok, true);
  assert.equal((await get("members/legacy")).ok, true);
  assert.equal((await write("members/legacy", { name: "Changed" })).status, 403);
});
test("CG shares and Football reads remain public", async () => {
  for (const collection of ["shares", "ratings"]) assert.equal((await query(collection, [], { allDescendants: true })).ok, true);
  for (const path of ["matches/m/adminRatings/r", "matches/m/liveEvents/e"]) assert.equal((await get(path)).ok, true);
});

test("legacy userRoles are own-read only and cannot grant superadmin", async () => {
  assert.equal((await seed("userRoles/alice", { roles: ["superadmin"] })).ok, true);
  assert.equal((await get("userRoles/alice", "alice")).ok, true);
  assert.equal((await get("userRoles/alice", "bob")).status, 403);
  assert.equal((await write("userRoles/bob", { roles: ["superadmin"] }, "bob")).status, 403);
});
