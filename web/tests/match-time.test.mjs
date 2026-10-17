import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";

const utils = loadSource("../src/lib/utils.ts").exports;
const date = "2026-10-20";
const time = "19:30";
const expected = "2026-10-20T12:30:00.000Z";

function setup(matchId = "match-1", extra = {}) {
  const writes = [];
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
  const ref = (...args) => ({ path: args.map((a) => typeof a === "string" ? a : a.path).filter(Boolean).join("/"), id: "new-match" });
  const write = (ref, data) => { writes.push({ path: ref.path, data }); };
  const firestore = {
    doc: (...args) => ref(...args, ...(args.length === 1 ? ["new-match"] : [])), collection: ref, query: (r) => r,
    serverTimestamp: () => "server-time", Timestamp: {},
    getDoc: async () => ({ exists: () => true, data: () => stored }),
    getDocs: async (ref) => ({ docs: ref.path === "members" ? [member, teams[1].members[0]].map((m) => ({ id: m.id, data: () => m })) : [], forEach() {} }),
    updateDoc: async (...args) => write(...args), setDoc: async (...args) => write(...args),
    writeBatch: () => ({ set: write, update: write, delete() {}, commit: async () => {} }),
  };
  const page = mountPage("SetupMatch", { date, time, teams, allMembers: teams.flatMap((t) => t.members), expenseItems: stored.expenseItems, isLoading: false }, {
    "react-router-dom": { useParams: () => ({ matchId }), useNavigate: () => () => {} },
    "@/hooks/use-toast": { toast() {} },
    "firebase/firestore": firestore,
    "@/lib/firebase": { db: {} },
    "@/lib/api": { postApiJson: async () => ({}) },
    "@/lib/utils": utils,
  }, { window: { location: { origin: "http://localhost" } }, navigator: { clipboard: { writeText: async () => {} } } });
  return { ...page, pageHost: page, writes };
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
  assert.equal(host.writes.find((w) => w.path === "configs/last_match").data.kickoffTime, time);
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
