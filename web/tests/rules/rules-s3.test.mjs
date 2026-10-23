import assert from "node:assert/strict";
import { before, test } from "node:test";
import { seed, get, write, query, remove } from "./emulator-client.mjs";

before(async () => {
  for (const [path, data] of Object.entries({
    "platformAccounts/s3owner": { role: "owner", status: "active" },
    "platformAccounts/s3disabled": { role: "owner", status: "disabled" },
    "platformAccounts/s3disableduser": { role: "user", status: "disabled" },
    "groupMembers/s3alpha_s3manager": { groupId: "s3alpha", uid: "s3manager", role: "manager" },
    "groupMembers/s3alpha_s3admin": { groupId: "s3alpha", uid: "s3admin", role: "admin", tabs: [] },
    "groupMembers/s3beta_s3other": { groupId: "s3beta", uid: "s3other", role: "manager" },
    "groupMembers/s3alpha_s3disabled": { groupId: "s3alpha", uid: "s3disabled", role: "manager" },
    "groupMembers/s3alpha_s3disableduser": { groupId: "s3alpha", uid: "s3disableduser", role: "manager" },
    "groupMembers/football-zigvy_s3football": { groupId: "football-zigvy", uid: "s3football", role: "admin" },
    "userRoles/s3legacy": { roles: ["superadmin"] },
    "members/s3alpha": { groupId: "s3alpha", name: "Alpha" },
    "members/s3beta": { groupId: "s3beta", name: "Beta" },
    "members/s3legacy": { name: "No backfill" },
    "matches/s3alpha": { groupId: "s3alpha", status: "PENDING" },
    "matches/s3beta": { groupId: "s3beta", status: "PENDING" },
    "matches/s3football": { groupId: "football-zigvy", status: "PENDING" },
    "matches/s3alpha/shares/share": { groupId: "s3alpha", amount: 100 },
    "matches/s3football/adminRatings/rating": { score: 5 },
    "matches/s3football/liveEvents/event": { type: "goal" },
    "notifications/s3alpha": { groupId: "s3alpha", read: false },
    "notifications/s3beta": { groupId: "s3beta", read: false },
    "groups/s3alpha/settings/lastMatch": { note: "Alpha" },
    "groups/s3alpha/settings/slack": { channelId: "C0123ABCD" },
    "appConfig/publicPasscode": { passcode: "fake-test-value" },
    "appConfig/s3unknown": { reserved: true },
    "configs/scoringWeights": { goal: 1 },
    "configs/last_match": { note: "Legacy" },
    "configs/s3unknown": { reserved: true },
    "actionConfigs/s3action": { label: "Goal" },
    ...Object.fromEntries(["paymentRequests", "paymentQueue", "slackQueue", "notificationTokens"].map((collection) => [`${collection}/s3server`, { groupId: "s3alpha" }])),
  })) assert.equal((await seed(path, data)).ok, true, path);
});

test("S3 anonymous clients cannot write members, matches or match subcollections", async () => {
  for (const path of ["members/s3anon", "matches/s3anon", "matches/s3alpha/shares/anon", "matches/s3alpha/attendance/anon", "matches/s3alpha/attendanceLog/anon", "matches/s3alpha/not_attending/anon"])
    assert.equal((await write(path, { groupId: "s3alpha" })).status, 403, path);
});
test("S3 manager and admin without tab write only their own group; owner writes both", async () => {
  for (const uid of ["s3manager", "s3admin", "s3owner"]) {
    for (const collection of ["members", "matches"]) {
      assert.equal((await write(`${collection}/s3new-${uid}`, { groupId: "s3alpha" }, uid)).ok, true);
      assert.equal((await write(`${collection}/s3alpha`, { groupId: "s3alpha", note: uid }, uid)).ok, true);
      assert.equal((await write(`${collection}/s3beta`, { groupId: "s3beta" }, uid)).status, uid === "s3owner" ? 200 : 403);
      assert.equal((await remove(`${collection}/s3new-${uid}`, uid)).ok, true);
    }
  }
  assert.equal((await write("members/s3beta", { groupId: "s3beta" }, "s3other")).ok, true);
  assert.equal((await write("members/s3alpha", { groupId: "s3alpha" }, "s3other")).status, 403);
});
test("S3 groupId is immutable and backfill is required", async () => {
  for (const uid of ["s3manager", "s3owner"]) {
    for (const collection of ["members", "matches"]) assert.equal((await write(`${collection}/s3alpha`, { groupId: "s3beta" }, uid)).status, 403);
    assert.equal((await write(`members/s3missing-${uid}`, { name: "Missing scope" }, uid)).status, 403);
    assert.equal((await write("members/s3legacy", { groupId: "s3alpha" }, uid)).status, 403);
  }
});
test("S3 shares and ratings require the parent group on create", async () => {
  for (const collection of ["shares", "ratings"]) {
    assert.equal((await write(`matches/s3alpha/${collection}/valid`, { groupId: "s3alpha" }, "s3manager")).ok, true);
    assert.equal((await write(`matches/s3alpha/${collection}/wrong`, { groupId: "s3beta" }, "s3manager")).status, 403);
    assert.equal((await write(`matches/s3alpha/${collection}/missing`, { score: 5 }, "s3manager")).status, 403);
    assert.equal((await write(`matches/s3alpha/${collection}/foreign`, { groupId: "s3alpha" }, "s3other")).status, 403);
  }
});
test("S3 migrated staff keep access but legacy userRoles and disabled memberships grant none", async () => {
  assert.equal((await write("members/s3football", { groupId: "football-zigvy" }, "s3football")).ok, true);
  assert.equal((await write("members/s3alpha", { groupId: "s3alpha" }, "s3football")).status, 403);
  for (const uid of ["s3legacy", "s3disabled", "s3disableduser"]) {
    assert.equal((await write("members/s3alpha", { groupId: "s3alpha" }, uid)).status, 403, uid);
    assert.equal((await get("notifications/s3alpha", uid)).status, 403, uid);
  }
});
test("S3 queues, requests and token documents are server-only for every actor", async () => {
  for (const collection of ["paymentRequests", "paymentQueue", "slackQueue", "notificationTokens"]) {
    for (const uid of [undefined, "s3manager", "s3owner", "s3disabled"]) {
      assert.equal((await get(`${collection}/s3server`, uid)).status, 403);
      assert.equal((await write(`${collection}/s3server`, { groupId: "s3alpha" }, uid)).status, 403);
      assert.equal((await remove(`${collection}/s3server`, uid)).status, 403);
    }
  }
});
test("S3 notifications are staff-readable and update-only within group", async () => {
  for (const uid of ["s3manager", "s3admin", "s3owner"]) {
    assert.equal((await get("notifications/s3alpha", uid)).ok, true);
    assert.equal((await write("notifications/s3alpha", { groupId: "s3alpha", read: true }, uid)).ok, true);
    assert.equal((await write(`notifications/s3new-${uid}`, { groupId: "s3alpha" }, uid)).status, 403);
    assert.equal((await remove("notifications/s3alpha", uid)).status, 403);
  }
  for (const uid of [undefined, "s3other"]) {
    assert.equal((await get("notifications/s3alpha", uid)).status, 403);
    assert.equal((await write("notifications/s3alpha", { read: false }, uid)).status, 403);
  }
  assert.equal((await query("notifications", [["groupId", "EQUAL", "s3alpha"]], { uid: "s3manager" })).ok, true);
  assert.equal((await query("notifications", [], { uid: "s3manager" })).status, 403);
});
test("S3 settings are scoped and Slack settings remain server-only writes", async () => {
  for (const uid of ["s3manager", "s3admin", "s3owner"]) {
    assert.equal((await get("groups/s3alpha/settings/lastMatch", uid)).ok, true);
    assert.equal((await write("groups/s3alpha/settings/lastMatch", { note: "Updated" }, uid)).ok, true);
    assert.equal((await get("groups/s3alpha/settings/slack", uid)).ok, true);
    assert.equal((await write("groups/s3alpha/settings/slack", { enabled: false }, uid)).status, 403);
    assert.equal((await get("groups/s3alpha/settings/unknown", uid)).status, 403);
    assert.equal((await write("groups/s3alpha/settings/unknown", {}, uid)).status, 403);
  }
  for (const uid of [undefined, "s3other", "s3disabled"]) {
    assert.equal((await get("groups/s3alpha/settings/lastMatch", uid)).status, 403);
    assert.equal((await write("groups/s3alpha/settings/lastMatch", {}, uid)).status, 403);
    assert.equal((await get("groups/s3alpha/settings/slack", uid)).status, 403);
  }
});
test("S3 group data and Football collections stay publicly readable", async () => {
  for (const path of ["members/s3alpha", "matches/s3alpha", "matches/s3alpha/shares/share", "matches/s3football/adminRatings/rating", "matches/s3football/liveEvents/event", "actionConfigs/s3action"])
    assert.equal((await get(path)).ok, true, path);
  for (const collection of ["members", "matches", "shares", "ratings"]) assert.equal((await query(collection, [], { allDescendants: ["shares", "ratings"].includes(collection) })).ok, true);
  assert.equal((await write("actionConfigs/s3action", { label: "Changed" }, "s3owner")).status, 403);
});
test("S3 Football liveEvents and adminRatings writes require Football staff", async () => {
  for (const collection of ["liveEvents", "adminRatings"]) {
    assert.equal((await write(`matches/s3football/${collection}/new`, { score: 5 }, "s3football")).ok, true);
    assert.equal((await write(`matches/s3football/${collection}/foreign`, { score: 5 }, "s3other")).status, 403);
  }
});
test("S3 Football global settings keep staff access while appConfig stays private", async () => {
  for (const uid of ["s3football", "s3owner"]) {
    for (const path of ["appConfig/publicPasscode", "configs/scoringWeights"]) {
      assert.equal((await get(path, uid)).ok, true);
      assert.equal((await write(path, { note: "Updated" }, uid)).ok, true);
    }
    assert.equal((await get("configs/last_match", uid)).ok, true);
    assert.equal((await write("configs/last_match", {}, uid)).status, 403);
    for (const path of ["appConfig/s3unknown", "configs/s3unknown"]) {
      assert.equal((await get(path, uid)).status, 403);
      assert.equal((await write(path, {}, uid)).status, 403);
    }
  }
  for (const uid of [undefined, "s3other", "s3disabled"]) for (const path of ["appConfig/publicPasscode", "configs/scoringWeights", "configs/last_match"])
    assert.equal((await get(path, uid)).status, 403);
});
