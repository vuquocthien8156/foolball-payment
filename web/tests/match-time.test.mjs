import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";

const groups = loadSource("../src/lib/groups.ts").exports;
const utils = loadSource("../src/lib/utils.ts").exports;
const date = "2026-10-20";
const time = "19:30";
const expected = "2026-10-20T12:30:00.000Z";

function setup(matchId = "match-1", extra = {}, options = {}) {
  const writes = [];
  const notifications = [];
  const member = { id: "member-1", name: "Test Player" };
  const teams = [
    { id: "A", name: "A", percent: 50, members: [member] },
    { id: "B", name: "B", percent: 50, members: [{ id: "member-2", name: "Second Player" }] },
  ];
  const stored = {
    date: { toDate: () => new Date(expected) }, teamsConfig: teams, teamCount: 2,
    expenseItems: [{ id: "pitch", description: "Pitch", amount: 100000, type: "SHARED", exemptMemberIds: [], teamPercents: { A: 50, B: 50 } }],
    ...extra,
  };
  const ref = (...args) => ({ path: args.map((a) => typeof a === "string" ? a : a.path).filter(Boolean).join("/"), id: typeof args.at(-1) === "string" ? args.at(-1) : "new-match" });
  const write = (ref, data) => { writes.push({ path: ref.path, data }); };
  const firestore = {
    doc: (...args) => ref(...args, ...(args.length === 1 ? ["new-match"] : [])), collection: ref, query: (r) => r,
    serverTimestamp: () => "server-time", Timestamp: {}, where: () => ({}),
    getDoc: async () => ({ exists: () => true, data: () => stored }),
    getDocs: async (ref) => ({ docs: ref.path === "members" ? [member, teams[1].members[0]].map((m) => ({ id: m.id, data: () => m })) : [], forEach(fn) { (ref.path.endsWith("/shares") ? options.existingShares || [] : []).forEach(fn); },
      ...(ref.path.endsWith("/shares") ? { docs: options.existingShares || [] } : {}) }),
    updateDoc: async (...args) => write(...args), setDoc: async (...args) => write(...args),
    writeBatch: () => {
      const operations = [];
      return { set: (ref, data) => operations.push([ref, data]), update: (ref, data) => operations.push([ref, data]), delete() {},
        commit: async () => {
          if (options.failMatchBatch && operations.some(([, data]) => data.status)) throw new Error("Simulated failure");
          operations.forEach(([ref, data]) => write(ref, data));
        } };
    },
  };
  const page = mountPage("SetupMatch", { date, time, teams, allMembers: teams.flatMap((t) => t.members), expenseItems: stored.expenseItems, isLoading: false, existingStatus: extra.status || "PENDING" }, {
    "react-router-dom": { useParams: () => ({ matchId }), useNavigate: () => () => {} },
    "@/hooks/use-toast": { toast() {} },
    "firebase/firestore": firestore,
    "@/lib/firebase": { db: {} },
    "@/lib/groups": groups,
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: "football-zigvy" }), useGroupPath: () => (sub = "") => `/g/football-zigvy/${sub}` },
    "@/lib/api": { postApiJson: async (path, payload) => { notifications.push({ path, payload }); return {}; } },
    "@/lib/utils": utils,
  }, { window: { location: { origin: "http://localhost" } }, navigator: { clipboard: { writeText: async () => {} } } });
  return { ...page, pageHost: page, writes, notifications };
}

for (const zone of ["Asia/Ho_Chi_Minh", "UTC", "America/Los_Angeles"]) {
  test(`all match save actions retain Vietnam time in ${zone}`, async () => {
    process.env.TZ = zone;
    for (const handler of ["handleSaveConfigToDb", "handleUpdateMatchConfig", "handleCreateMatchForAttendance", "handleSave"]) {
      const host = setup();
      await host.page[handler]();
      const matchWrite = host.writes.findLast((w) => w.path.startsWith("matches/") && w.data.date);
      assert.ok(matchWrite, `${handler} must save kickoff on the match`);
      assert.equal(matchWrite.data.date.toISOString(), expected, handler);
      if (handler === "handleSave") assert.equal(matchWrite.data.status, "COMPLETED");
    }
  });

  test(`loading an existing match retains wall-clock time in ${zone}`, async () => {
    process.env.TZ = zone;
    const host = setup();
    await host.page.fetchData();
    assert.equal(host.states.get("date"), date);
    assert.equal(host.states.get("time"), time);
  });
}

test("Save Config remembers time for new matches without reusing an old date", async () => {
  const host = setup();
  // Explicitly test a new route, rather than setup's default existing match.
  const newHost = setup(null, { kickoffTime: "20:45" });
  await newHost.page.fetchData();
  assert.equal(newHost.states.get("time"), "20:45");
  assert.equal(newHost.states.get("date"), date);
  await host.page.handleSaveConfigToDb();
  assert.equal(host.writes.find((w) => w.path === "groups/football-zigvy/settings/lastMatch").data.kickoffTime, time);
});

test("invalid or missing kickoff is rejected before any write", async () => {
  for (const invalid of ["", "25:00"]) {
    for (const handler of ["handleSaveConfigToDb", "handleUpdateMatchConfig", "handleCreateMatchForAttendance", "handleSave"]) {
    const host = setup();
    host.states.set("time", invalid);
    host.pageHost.render();
    await host.pageHost.page[handler]();
    assert.equal(host.writes.length, 0);
    }
  }
});


test("calculate and publish saves both new and existing bills in one batch", async () => {
  for (const matchId of [null, "match-1"]) {
    const host = setup(matchId);
    await host.page.handleSave(true);
    const matchWrite = host.writes.findLast((write) => write.data.status && write.data.date);
    assert.equal(matchWrite.data.status, "PUBLISHED");
    assert.equal(host.writes.filter((write) => write.data.memberId).length, 2);
    assert.equal(host.notifications.length, 1);
    assert.equal(host.notifications[0].path, "/notify/match-published");
    assert.equal(host.notifications[0].payload.matchId, matchId || "new-match");
  }
});

test("calculate only retains a private bill and does not publish notifications", async () => {
  const host = setup();
  await host.page.handleSave(false);
  assert.equal(host.writes.findLast((write) => write.data.status && write.data.date).data.status, "COMPLETED");
  assert.equal(host.notifications.length, 0);
});

test("failed bill write cannot publish or notify", async () => {
  const host = setup("match-1", {}, { failMatchBatch: true });
  await host.page.handleSave(true);
  assert.equal(host.writes.filter((write) => write.data.status).length, 0);
  assert.equal(host.notifications.length, 0);
});

test("recalculating cannot replace debts that were already paid", async () => {
  const paid = { id: "paid-share", data: () => ({ status: "PAID", amount: 10000 }) };
  const host = setup("match-1", { status: "PUBLISHED" }, { existingShares: [paid] });
  await host.page.handleSave(true);
  assert.equal(host.writes.length, 0);
  assert.equal(host.notifications.length, 0);
});

test("saving an already-published bill does not repeat its notification", async () => {
  const host = setup("match-1", { status: "PUBLISHED" });
  await host.page.handleSave(true);
  assert.equal(host.writes.findLast((write) => write.data.status && write.data.date).data.status, "PUBLISHED");
  assert.equal(host.notifications.length, 0);
});
