import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";

async function setup(t, extra = {}) {
  const fake = createFakeFirestore({
    "groups/alpha": { status: "active" },
    "groups/archived": { status: "archived" },
    "members/a": { groupId: "alpha", name: "Stored name" },
    "members/b": { groupId: "beta", name: "Other group" },
    "matches/a": { groupId: "alpha", status: "PENDING" },
    "matches/b": { groupId: "beta", status: "PENDING" },
    ...extra,
  });
  const actions = [];
  const { createPublicRouter } = loadCjs("../../server/lib/publicRoutes.js", {
    "./groups": loadCjs("../../server/lib/groups.js"),
  });
  const host = await startRouter(createPublicRouter({ db: fake.db, FieldValue: fake.FieldValue, Timestamp,
    onMemberAction: async (action) => { actions.push(action); },
  }));
  t.after(host.close);
  return { ...fake, actions, async request(endpoint, body, method = "POST", gid = "alpha") {
    const res = await fetch(`${host.url}/${gid}/${endpoint}`, { method,
      headers: { "Content-Type": "application/json", "User-Agent": "Fixture agent" }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  } };
}
const logs = (host) => [...host.records].filter(([path]) => path.startsWith("matches/a/attendanceLog/")).map(([, data]) => data);
test("public attendance preserves records, transition logs and notification actions; retries skip", async (t) => {
  const host = await setup(t);
  const body = { matchId: "a", memberId: "a", action: "attending", memberName: "Spoofed", timestamp: 1, groupId: "beta" };
  assert.equal((await host.request("attendance", body)).status, 200);
  const record = host.records.get("matches/a/attendance/a");
  assert.deepEqual(Object.keys(record).sort(), ["memberName", "timestamp", "userAgent"]);
  assert.equal(record.memberName, "Stored name"); assert.equal(record.userAgent, "Fixture agent");
  assert.ok(record.timestamp instanceof Timestamp);
  assert.equal(logs(host)[0].type, "ATTEND");
  assert.equal((await host.request("attendance", body)).data.skipped, true);
  assert.equal(logs(host).length, 1); assert.equal(host.actions.length, 1);
  await host.request("attendance", { ...body, action: "not_attending" });
  assert.equal(host.records.has("matches/a/attendance/a"), false);
  assert.ok(host.records.has("matches/a/not_attending/a"));
  assert.deepEqual(logs(host).map((log) => log.type), ["ATTEND", "CANCEL_ATTEND"]);
  await host.request("attendance", body);
  assert.deepEqual(logs(host).map((log) => log.type), ["ATTEND", "CANCEL_ATTEND", "ATTEND"]);
  assert.deepEqual(host.actions.map((action) => action.action), ["ATTEND", "CANCEL_ATTEND", "CANCEL_NOT_ATTEND", "ATTEND"]);
  for (const log of logs(host)) {
    assert.deepEqual(Object.keys(log).sort(), ["memberId", "memberName", "timestamp", "type", "userAgent"]);
    assert.equal(log.memberName, "Stored name"); assert.equal(log.memberId, "a");
  }
  assert.ok(host.actions.every((action) => action.groupId === "alpha" && action.memberName === "Stored name"));
});
test("initial not-attending records NOT_ATTEND; published matches reject writes", async (t) => {
  const host = await setup(t);
  await host.request("attendance", { matchId: "a", memberId: "a", action: "not_attending" });
  assert.equal(logs(host)[0].type, "NOT_ATTEND");
  host.records.set("matches/a", { groupId: "alpha", status: "PUBLISHED" });
  assert.equal((await host.request("attendance", { matchId: "a", memberId: "a", action: "attending" })).status, 409);
  assert.equal(host.records.has("matches/a/attendance/a"), false);
});
test("auto-attendance changes only the enabled flag", async (t) => {
  const host = await setup(t);
  assert.equal((await host.request("auto-attendance", { memberId: "a", enabled: true, role: "owner", groupId: "beta" })).status, 200);
  assert.deepEqual(host.records.get("members/a"), { groupId: "alpha", name: "Stored name", autoAttendance: true });
  await host.request("auto-attendance", { memberId: "a", enabled: false });
  assert.equal(host.records.get("members/a").autoAttendance, false);
});
test("notification registration preserves shape, supports anonymous tokens, and removal derives member", async (t) => {
  const host = await setup(t);
  assert.equal((await host.request("notification-token", { token: "fake-token", memberId: "a", role: "owner", userAgent: "Spoofed" })).status, 200);
  const token = host.records.get("notificationTokens/fake-token");
  assert.deepEqual(Object.keys(token).sort(), ["groupId", "memberId", "token", "updatedAt", "userAgent"]);
  assert.equal(token.userAgent, "Fixture agent"); assert.equal(token.groupId, "alpha");
  assert.equal(host.records.get("members/a").fcmToken, "fake-token");
  await host.request("notification-token", { token: "anonymous" });
  assert.equal(host.records.get("notificationTokens/anonymous").memberId, null);
  assert.equal((await host.request("notification-token", { token: "fake-token", memberId: "b" }, "DELETE")).status, 200);
  assert.equal(host.records.has("notificationTokens/fake-token"), false);
  assert.equal(host.records.get("members/a").fcmToken, null);
  assert.equal(host.records.get("members/b").fcmToken, undefined);
  assert.equal((await host.request("notification-token", { token: "fake-token" }, "DELETE")).status, 200);
});
test("removing an old token does not clear a newer member token", async (t) => {
  const host = await setup(t, { "notificationTokens/old": { groupId: "alpha", memberId: "a" }, "members/a": { groupId: "alpha", fcmToken: "new" } });
  await host.request("notification-token", { token: "old" }, "DELETE");
  assert.equal(host.records.get("members/a").fcmToken, "new");
});
test("each public endpoint rejects archived groups and foreign members without writes", async (t) => {
  for (const [endpoint, body, method] of [
    ["attendance", { memberId: "b", matchId: "a", action: "attending" }, "POST"],
    ["auto-attendance", { memberId: "b", enabled: true }, "POST"],
    ["notification-token", { memberId: "b", token: "foreign" }, "POST"],
    ["notification-token", { token: "foreign" }, "DELETE"],
  ]) {
    const host = await setup(t, { "notificationTokens/foreign": { groupId: "alpha", memberId: "b" } });
    const before = JSON.stringify([...host.records]);
    assert.equal((await host.request(endpoint, body, method)).status, 409, endpoint);
    assert.equal((await host.request(endpoint, body, method, "archived")).status, 403, endpoint);
    assert.equal(JSON.stringify([...host.records]), before);
    assert.equal(host.actions.length, 0);
  }
});
test("foreign match and token groups are rejected; missing records are not created", async (t) => {
  const host = await setup(t, { "notificationTokens/foreign": { groupId: "beta" } });
  assert.equal((await host.request("attendance", { matchId: "b", memberId: "a", action: "attending" })).status, 409);
  for (const method of ["POST", "DELETE"]) assert.equal((await host.request("notification-token", { token: "foreign" }, method)).status, 409);
  assert.equal((await host.request("auto-attendance", { memberId: "missing", enabled: true })).status, 404);
  assert.equal((await host.request("attendance", { memberId: "a", matchId: "missing", action: "attending" })).status, 404);
  assert.equal(host.records.has("members/missing"), false);
});
test("invalid public payloads and IDs return 400 without database writes", async (t) => {
  const host = await setup(t);
  for (const [endpoint, body] of [
    ["attendance", { memberId: "a", matchId: "a", action: "invalid" }],
    ["attendance", { memberId: "a/x", matchId: "a", action: "attending" }],
    ["auto-attendance", { memberId: "a", enabled: "true" }],
    ["notification-token", { token: "a/b" }],
    ["notification-token", { token: "fake", memberId: 123 }],
  ]) assert.equal((await host.request(endpoint, body)).status, 400);
  assert.equal(host.log.filter((entry) => entry.op).length, 0);
});
