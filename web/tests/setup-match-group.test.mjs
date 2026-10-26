import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const utils = loadSource("../src/lib/utils.ts").exports;
function setup(gid, records = {}, matchId, sport = "football") {
  const fake = createFakeFirestore({ "members/a": { name: "A", groupId: gid }, "members/b": { name: "B", groupId: gid }, "members/other": { name: "Other", groupId: "other-group" }, ...records });
  const reads = [], navigations = [], requests = [], copied = [];
  const getDoc = fake.firestore.getDoc;
  fake.firestore.getDoc = (ref) => { reads.push(ref.path); return getDoc(ref); };
  const groupPath = (sub) => groups.groupPath(gid, sub);
  const host = mountPage("SetupMatch", {
    isLoading: false, date: "2026-10-20", time: "19:30", teamCount: 2,
    teams: [{ id: "A", name: "A", percent: 50, members: [{ id: "a", name: "A" }] }, { id: "B", name: "B", percent: 50, members: [{ id: "b", name: "B" }] }],
    expenseItems: [{ id: "court", description: "Court", amount: 60000, type: "SHARED", exemptMemberIds: [], teamPercents: { A: 50, B: 50 } }],
  }, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid, group: { sport } }), useGroupPath: () => groupPath },
    "@/lib/groups": groups, "@/lib/utils": utils, "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore,
    "react-router-dom": { useParams: () => ({ matchId }), useNavigate: () => (path) => navigations.push(path) },
    "@/hooks/use-toast": { toast() {} },
    "@/lib/api": { postApiJson: async (path, payload) => { requests.push({ path, payload }); return {}; } },
  }, { window: { location: { origin: "http://localhost" } }, navigator: { clipboard: { writeText: async (value) => copied.push(value) } } });
  return { ...fake, host, reads, navigations, requests, copied };
}
const config = { teamCount: 2, teamsConfig: [], venueName: "Saved court", kickoffTime: "20:00" };
test("loads lastMatch from group settings and members query is scoped", async () => {
  const { host, reads, log } = setup("badm-1", { "groups/badm-1/settings/lastMatch": config });
  await host.page.fetchData();
  assert.equal(host.states.get("venueName"), "Saved court");
  assert.ok(reads.includes("groups/badm-1/settings/lastMatch"));
  assert.ok(log.find((entry) => entry.path === "members").constraints.some((c) => c.field === "groupId" && c.value === "badm-1"));
});
test("default group falls back to configs/last_match; non-default never does", async () => {
  for (const gid of ["football-zigvy", "badm-1"]) {
    const { host, reads } = setup(gid, { "configs/last_match": config });
    await host.page.fetchData();
    assert.equal(reads.includes("configs/last_match"), gid === "football-zigvy");
    assert.equal(host.states.get("venueName"), gid === "football-zigvy" ? "Saved court" : "");
  }
});
test("new match and shares carry groupId; publish payload has groupId; config writes only new path", async () => {
  const { host, log, requests } = setup("badm-1");
  await host.page.handleSave(true);
  const writes = log.filter((entry) => entry.op);
  const match = writes.find((entry) => /^matches\/[^/]+$/.test(entry.path));
  assert.ok(match);
  assert.equal(match.data.groupId, "badm-1");
  const shares = writes.filter((entry) => entry.path.includes("/shares/"));
  assert.equal(shares.length, 2);
  assert.ok(shares.every((entry) => entry.data.groupId === "badm-1"));
  assert.ok(writes.some((entry) => entry.path === "groups/badm-1/settings/lastMatch"));
  assert.equal(writes.some((entry) => entry.path === "configs/last_match"), false);
  assert.equal(requests[0].payload.groupId, "badm-1");
});
test("match from other group redirects without loading attendance or config", async () => {
  const { host, navigations, log } = setup("badm-1", { "matches/other": { groupId: "football-zigvy", ...config } }, "other");
  await host.page.fetchData();
  assert.deepEqual(navigations, ["/g/badm-1/admin/setup"]);
  assert.equal(log.some((entry) => entry.path === "matches/other/attendance"), false);
  assert.equal(host.states.get("venueName"), "");
});
test("attendance match creation writes group and notification context", async () => {
  const { host, log, requests, copied } = setup("badm-1");
  await host.page.handleCreateMatchForAttendance();
  assert.equal(log.find((entry) => entry.op === "set").data.groupId, "badm-1");
  assert.equal(requests[0].payload.groupId, "badm-1");
  assert.equal(copied[0], "http://localhost/g/badm-1/public/attendance");
});

test("match creation without attendance skips notifications and clipboard copy, and hides calculation buttons", async () => {
  const { host, log, requests, copied } = setup("badm-1");
  await host.page.handleCreateMatch(false);
  const matchSet = log.find((entry) => entry.op === "set");
  assert.equal(matchSet.data.groupId, "badm-1");
  assert.equal(matchSet.data.skipAutoAttendance, true);
  assert.equal(requests.length, 0);
  assert.equal(copied.length, 0);
  const rendered = JSON.stringify(host.render());
  assert.equal(rendered.includes("Chỉ tính tiền (nháp)"), false);
  assert.equal(rendered.includes("Tính tiền & công khai"), false);
  assert.ok(rendered.includes("Tạo trận (không điểm danh)") || rendered.includes("Tạo buổi (không điểm danh)"));
});

test("badminton loads one participant list and divides costs equally", async () => {
  const saved = { ...config, expenseItems: [{ id: "court", description: "Court", amount: 60001, type: "SHARED", exemptMemberIds: [], teamPercents: { A: 50, B: 50 } }], teamsConfig: [
    { id: "A", name: "Old A", percent: 50, members: [{ id: "a" }] },
    { id: "B", name: "Old B", percent: 50, members: [{ id: "b" }] },
  ] };
  const { host, log } = setup("badm-1", { "groups/badm-1/settings/lastMatch": saved }, undefined, "badminton");
  await host.page.fetchData();
  host.render();
  assert.equal(host.states.get("teams")[0].members.length, 2);
  assert.equal(host.states.get("teams")[1].members.length, 0);
  assert.equal(host.states.get("expenseItems")[0].type, "EQUAL");
  const rendered = JSON.stringify(host.render());
  assert.equal(rendered.includes("Số đội"), false);
  assert.equal(rendered.includes("Tên các đội"), false);
  assert.equal(rendered.includes("Calculate"), false);
  await host.page.handleSave(false);
  const match = log.find((entry) => entry.op && /^matches\/[^/]+$/.test(entry.path));
  assert.equal(match.data.teamCount, 1);
  assert.equal(match.data.teamsConfig.length, 1);
  assert.equal(match.data.teamsConfig[0].name, "Người tham gia");
  const shares = log.filter((entry) => entry.op && entry.path.includes("/shares/"));
  assert.equal(shares.length, 2);
  assert.deepEqual(shares.map((entry) => entry.data.amount).sort((a, b) => a - b), [30000, 30001]);
  assert.ok(shares.every((entry) => entry.data.groupId === "badm-1"));
});

test("badminton participant buttons add and remove without drag and drop", async () => {
  const { host } = setup("badm-1", {}, undefined, "badminton");
  host.states.set("teams", [{ id: "A", name: "Người tham gia", percent: 100, members: [] }]);
  host.states.set("pool", [{ id: "a", name: "A" }]);
  host.render();
  host.page.toggleParticipant({ id: "a", name: "A" }, true);
  host.render();
  assert.equal(host.states.get("teams")[0].members.length, 1);
  assert.equal(host.states.get("pool").length, 0);
  host.page.toggleParticipant({ id: "a", name: "A" }, false);
  host.render();
  assert.equal(host.states.get("teams")[0].members.length, 0);
  assert.equal(host.states.get("pool").length, 1);
});

test("new badminton setup replaces stale football defaults before editing", async () => {
  const { host } = setup("badm-1", {}, undefined, "badminton");
  await host.page.fetchData();
  host.render();
  assert.equal(host.states.get("expenseItems")[0].type, "EQUAL");
  assert.equal(host.states.get("teams")[0].percent, 100);
  assert.equal(host.states.get("teams")[0].name, "Người tham gia");
});
