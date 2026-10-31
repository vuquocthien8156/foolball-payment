import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";

const utils = loadSource("../src/lib/utils.ts").exports;
const groups = loadSource("../src/lib/groups.ts").exports;
const features = loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports;
const timestamp = { seconds: 1794000000, toDate: () => new Date(1794000000000) };
const match = (id, isDeleted = false) => ({ id, date: timestamp, totalAmount: 0, isDeleted });
const snapshot = (items) => ({ docs: items, forEach: (fn) => items.forEach(fn) });
const document = (id, data) => ({ id, data: () => data });

function setup(matches, delayAttendance) {
  const reads = [];
  const writes = [];
  const requests = [];
  const toRef = (...args) => ({ path: args.filter((a) => typeof a === "string").join("/") });
  const toast = () => {};
  const host = mountPage("Attendance", { isLoading: false }, {
    "react-router-dom": { useNavigate: () => () => {} },
    "@/components/ui/use-toast": { useToast: () => ({ toast }) },
    "@/hooks/useLocalStorage": { default: () => [[], () => {}] },
    "@/lib/utils": utils,
    "@/lib/firebase": { db: {} },
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: "football-zigvy", group: { sport: "football" } }), useGroupPath: () => (sub = "") => `/g/football-zigvy/${sub}` },
    "@/lib/groups": groups,
    "@/lib/features": features,
    "@/lib/notifications": { ensureNotificationToken: async () => null },
    "@/lib/api": { postApiJson: async (path, payload) => { requests.push({ path, payload }); return {}; } },
    "firebase/firestore": {
      doc: toRef, collection: toRef,
      query: (ref, ...constraints) => ({ ...ref, constraints }),
      where: (...args) => ({ where: args }), orderBy: (...args) => ({ orderBy: args }), limit: (count) => ({ limit: count }),
      Timestamp: { now: () => timestamp },
      getDocs: async (ref) => {
        reads.push(ref.path);
        if (ref.path === "matches") {
          const count = ref.constraints.find((c) => c.limit)?.limit ?? matches.length;
          return snapshot(matches.slice(0, count).map((m) => document(m.id, m)));
        }
        if (ref.path === "members") return snapshot([document("player", { name: "Test Player" })]);
        if (delayAttendance && ref.path.endsWith("/attendance")) await delayAttendance(ref.path);
        const memberId = ref.path.split("/")[1] === "older" ? "older-player" : "newer-player";
        return snapshot([document(memberId, { timestamp, memberName: memberId })]);
      },
      onSnapshot: () => () => {},
      runTransaction: async (_db, fn) => fn({ set: (ref) => writes.push(ref.path), delete: (ref) => writes.push(ref.path) }),
      addDoc: async () => {}, serverTimestamp: () => timestamp,
    },
  }, { navigator: { userAgent: "silent-test" } });
  return { host, reads, writes, requests };
}

test("all pending matches are available; deleted newest match cannot hide active matches", async () => {
  const { host } = setup([match("deleted", true), match("newer"), match("older")]);
  await host.page.fetchMatchAndMembers();
  assert.equal(host.states.get("matchId"), "newer");
  assert.equal(host.states.get("pendingMatches").length, 2);
});

test("zero or one match retains the existing default flow", async () => {
  for (const matches of [[], [match("only")]]) {
    const { host } = setup(matches);
    await host.page.fetchMatchAndMembers();
    assert.equal(host.states.get("matchId"), matches[0]?.id ?? null);
  }
});

test("selection and refresh keep attendance, history, and writes on the selected match", async () => {
  const { host, reads, writes, requests } = setup([match("newer"), match("older")]);
  await host.page.fetchMatchAndMembers("older");
  await host.flush();
  assert.equal(host.states.get("matchId"), "older");
  assert.deepEqual([...host.states.get("attendance").keys()], ["older-player"]);
  assert.equal(host.states.get("teamBuilderInitialized"), false);
  assert.equal(host.states.get("attendanceHistory").length, 0);
  await host.page.fetchMatchAndMembers();
  await host.flush();
  assert.equal(host.states.get("matchId"), "older");
  await host.page.handleUpdateStatus("player", "Test Player", "attending");
  assert.ok(reads.includes("matches/older/not_attending"));
  assert.equal(writes.length, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/public/football-zigvy/attendance");
  assert.equal(requests[0].payload.matchId, "older");
  assert.equal(requests[0].payload.action, "attending");
});

test("late reads from a previous match cannot replace the new selection", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let waiting = false;
  const { host } = setup([match("newer"), match("older")], (path) => {
    if (path.includes("newer") && !waiting) { waiting = true; return gate; }
    return Promise.resolve();
  });
  const first = host.page.fetchMatchAndMembers("newer");
  await new Promise((resolve) => setImmediate(resolve));
  await host.page.fetchMatchAndMembers("older");
  release();
  await first;
  assert.equal(host.states.get("matchId"), "older");
  assert.deepEqual([...host.states.get("attendance").keys()], ["older-player"]);
});
