import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const features = loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports;
const utils = loadSource("../src/lib/utils.ts").exports;
function setup(page, gid = "badm-1") {
  const group = { sport: gid === "football-zigvy" ? "football" : "badminton" };
  const fake = createFakeFirestore({
    "members/a": { groupId: gid, name: "A" }, "members/b": { groupId: "football-zigvy", name: "B" },
    "matches/m1": { groupId: gid, status: "PENDING", date: Timestamp.now(), createdAt: Timestamp.now(), teamsConfig: [] },
    "matches/other": { groupId: "football-zigvy", status: "PENDING", date: Timestamp.now(), createdAt: Timestamp.now(), teamsConfig: [] },
  });
  const requests = [], storage = [], registrations = [];
  const toast = () => {};
  const host = mountPage(page, { isLoading: false }, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid, group }), useGroupPath: () => (sub) => groups.groupPath(gid, sub) },
    "@/lib/groups": groups, "@/lib/features": features, "@/lib/utils": utils,
    "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore,
    "@/lib/notifications": { ensureNotificationToken: async (...args) => { registrations.push(args); return null; } },
    "@/lib/api": { postApiJson: async (path, payload) => { requests.push({ path, payload }); return {}; } },
    "react-router-dom": { useNavigate: () => () => {}, Link: "Link" },
    "@/components/ui/use-toast": { useToast: () => ({ toast }) }, "@/hooks/useLocalStorage": { default: () => [[], () => {}] },
  }, {
    navigator: { userAgent: "fake" }, Notification: { permission: "default" },
    localStorage: { getItem: (key) => { storage.push(key); return null; }, setItem: (key) => storage.push(key) },
  });
  return { ...fake, host, requests, storage, registrations };
}
test("attendance pending matches and members queries have groupId", async () => {
  const { host, log } = setup("Attendance");
  await host.page.fetchMatchAndMembers();
  assert.deepEqual(Array.from(host.states.get("pendingMatches"), (match) => match.id), ["m1"]);
  assert.deepEqual(Array.from(host.states.get("members"), (member) => member.id), ["a"]);
  for (const entry of log.filter((entry) => ["members", "matches"].includes(entry.path))) {
    assert.ok(entry.constraints.some((c) => c.field === "groupId" && c.value === "badm-1"));
  }
});
test("attendance request uses the active group endpoint", async () => {
  const { host, requests } = setup("Attendance");
  await host.page.fetchMatchAndMembers();
  await host.flush();
  await host.page.handleUpdateStatus("a", "A", "attending");
  assert.equal(requests[0].path, "/public/badm-1/attendance");
  assert.equal(requests[0].payload.matchId, "m1");
  assert.equal(requests[0].payload.memberId, "a");
  assert.equal(requests[0].payload.action, "attending");
});
test("portal registration stays scoped and badminton skips football rankings", async () => {
  const { host, storage, registrations, log } = setup("PublicPortal");
  await host.flush({ runEffects: true });
  assert.deepEqual(storage, ["publicNotifyPrompted:badm-1", "publicNotifyPrompted:badm-1"]);
  assert.deepEqual(registrations, [[null, "badm-1"]]);
  const matches = log.filter((entry) => entry.path === "matches");
  assert.equal(matches.length, 0);
  assert.equal(host.states.get("isLoadingHighlight"), false);
  assert.equal(host.states.get("isLoadingScoreboard"), false);
  const football = setup("PublicPortal", "football-zigvy");
  await football.host.flush({ runEffects: true });
  const footballReads = football.log.filter((entry) => entry.path === "matches");
  assert.equal(footballReads.length, 2);
  assert.ok(footballReads.every((entry) => entry.constraints.some((c) => c.field === "groupId" && c.value === "football-zigvy")));
});
test("notification helpers use group server endpoints and never write Firestore", async () => {
  const fake = createFakeFirestore({ "members/a": { groupId: "badm-1", name: "A" } });
  const requests = [];
  const notifications = loadSource("../src/lib/notifications.ts", {
    "firebase/firestore": fake.firestore, "@/lib/firebase": { db: fake.db, requestNotificationPermission: async () => "fake-local-token" },
    "@/lib/api": { postApiJson: async (path, body) => requests.push({ method: "POST", path, body }),
      apiRequest: async (method, path, body) => requests.push({ method, path, body }) },
  }).exports;
  await notifications.saveNotificationToken("fake-token", "a", "badm-1");
  await notifications.ensureNotificationToken(null, "badm-1");
  await notifications.removeNotificationToken("fake-token", "badm-1");
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { method: "POST", path: "/public/badm-1/notification-token", body: { token: "fake-token", memberId: "a" } },
    { method: "POST", path: "/public/badm-1/notification-token", body: { token: "fake-local-token", memberId: null } },
    { method: "DELETE", path: "/public/badm-1/notification-token", body: { token: "fake-token" } },
  ]);
  assert.equal(fake.log.filter((entry) => entry.op).length, 0);
});
