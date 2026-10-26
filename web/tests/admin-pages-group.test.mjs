import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const features = loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports;
const utils = loadSource("../src/lib/utils.ts").exports;
function setup() {
  const gid = "badm-1";
  const fake = createFakeFirestore({
    "members/a": { groupId: gid, name: "A" }, "members/b": { groupId: "football-zigvy", name: "B" },
    "matches/m1": { groupId: gid, status: "PUBLISHED", date: Timestamp.now(), totalAmount: 10000, teamsConfig: [] },
    "matches/other": { groupId: "football-zigvy", status: "PUBLISHED", date: Timestamp.now(), totalAmount: 20000, teamsConfig: [] },
    "matches/m1/shares/a": { groupId: gid, memberId: "a", amount: 10000, status: "PENDING" },
    "matches/other/shares/b": { groupId: "football-zigvy", memberId: "b", amount: 20000, status: "PENDING" },
  });
  const params = new URLSearchParams();
  const actions = { weights: {}, loading: false };
  const host = mountPage("Matches", {}, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid, group: { sport: "badminton" } }), useGroupPath: () => (sub) => groups.groupPath(gid, sub) },
    "@/lib/features": features, "@/lib/groups": groups, "firebase/firestore": fake.firestore,
    "@/lib/firebase": { db: fake.db }, "@/lib/utils": utils,
    "@/lib/liveStats": { aggregateLiveStats: () => new Map() }, "@/hooks/useActionConfigs": { useActionConfigs: () => actions },
    "@/hooks/use-toast": { toast() {} }, "@/lib/api": { postApiJson: async () => ({}) },
    "react-router-dom": { useNavigate: () => () => {}, useSearchParams: () => [params, () => {}] },
    "react-dom": { createPortal: (child) => child }, html2canvas: { default() {} },
  }, { window: { location: { origin: "http://localhost" } } });
  return { ...fake, host };
}
for (const path of ["members", "matches"]) test(`${path} query carries groupId`, async () => {
  const { host, log } = setup();
  await host.flush({ runEffects: true });
  const reads = log.filter((entry) => entry.path === path);
  assert.ok(reads.length);
  for (const entry of reads) assert.ok(entry.constraints.some((c) => c.field === "groupId" && c.value === "badm-1"));
  const state = host.states.get(path);
  assert.equal(path === "matches" ? state.some((match) => match.id === "other") : state.has("b"), false);
});
test("pending shares CG query carries groupId", async () => {
  const { host, log } = setup();
  await host.page.fetchPendingSharesAcrossAllMatches();
  assert.ok(log.find((entry) => entry.group).constraints.some((c) => c.field === "groupId" && c.value === "badm-1"));
  assert.equal(host.states.get("pendingSharesMap").has("b"), false);
});
test("new share writes carry groupId if introduced; current Matches page has no share create path", () => {
  const source = fs.readFileSync(new URL("../src/pages/Matches.tsx", import.meta.url), "utf8");
  const root = ts.createSourceFile("Matches.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const shareCreates = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && /^(setDoc|addDoc|batch\.set)$/.test(node.expression.getText(root)) && node.arguments[0]?.getText(root).includes('"shares"')) {
      shareCreates.push(node);
      assert.match(node.arguments[1].getText(root), /\bgroupId\b/);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.equal(shareCreates.length, 0, "Review any new share create path and give it runtime coverage");
});

test("AdminLayout has no notification subscription or bell", async () => {
  const fake = createFakeFirestore({
    "notifications/own": { groupId: "badm-1", message: "Own", matchId: "m1", shareId: "s1", isRead: false, createdAt: Timestamp.now() },
    "notifications/other": { groupId: "football-zigvy", message: "Other", matchId: "other", createdAt: Timestamp.now() },
    "matches/m1": { groupId: "badm-1" }, "matches/other": { groupId: "football-zigvy" },
  });
  const navigations = [];
  const host = mountPage("../components/AdminLayout", {}, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: "badm-1", group: { sport: "badminton" }, loading: false }), useGroupPath: () => (sub) => groups.groupPath("badm-1", sub) },
    "@/lib/features": features, "@/lib/groups": groups, "@/lib/utils": utils, "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore,
    "firebase/auth": {}, "@/contexts/AuthContext": { useAuth: () => ({ user: { uid: "fake" } }) },
    "@/hooks/useGroupRole": { useGroupRole: () => ({ role: "admin", isManager: false, tabs: [], loading: false }) },
    "@/hooks/usePlatformAccount": { usePlatformAccount: () => ({ account: null }) },
    "react-router-dom": { NavLink: "NavLink", Outlet: "Outlet", useLocation: () => ({ pathname: "/g/badm-1/admin/matches" }), useNavigate: () => (path) => navigations.push(path) }, "@/hooks/use-toast": { toast() {} },
  }, { window: { location: { pathname: "/g/badm-1/admin/matches" } } });
  await host.flush({ runEffects: true });
  assert.equal(fake.log.some((entry) => entry.path === "notifications"), false);
  assert.equal(host.states.has("notifications"), false);
  const rendered = JSON.stringify(host.render());
  assert.equal(rendered.includes("Toggle notifications"), false);
  assert.equal(rendered.includes('"type":"Bell"'), false);
});

test("AdminLayout renders quick group switcher with separate main and test groups in header", async () => {
  const fake = createFakeFirestore();
  const navigations = [];
  const host = mountPage("../components/AdminLayout", {}, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: "badm-1", group: { name: "Badminton Club", sport: "badminton" }, loading: false }), useGroupPath: () => (sub) => groups.groupPath("badm-1", sub) },
    "@/lib/features": features, "@/lib/groups": groups, "@/lib/utils": utils, "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore,
    "firebase/auth": {}, "@/contexts/AuthContext": { useAuth: () => ({ user: { uid: "fake" } }) },
    "@/hooks/useGroupRole": { useGroupRole: () => ({ role: "owner", isManager: true, tabs: [], loading: false }) },
    "@/hooks/usePlatformAccount": { usePlatformAccount: () => ({ account: { uid: "fake", role: "owner", status: "active" } }) },
    "@/lib/api": { apiRequest: async () => [{ id: "badm-1", name: "Badminton Club", sport: "badminton", isTest: false }, { id: "test-badm", name: "[Test] Badminton Club", sport: "badminton", isTest: true }] },
    "react-router-dom": { NavLink: "NavLink", Outlet: "Outlet", useLocation: () => ({ pathname: "/g/badm-1/admin/matches" }), useNavigate: () => (path) => navigations.push(path) }, "@/hooks/use-toast": { toast() {} },
  }, { window: { location: { pathname: "/g/badm-1/admin/matches" } } });
  await host.flush({ runEffects: true });
  const rendered = JSON.stringify(host.render());
  assert.ok(rendered.includes("Nhóm chính"));
  assert.ok(rendered.includes("Nhóm thử nghiệm (Test)"));
  assert.ok(rendered.includes("Badminton Club"));
  assert.ok(rendered.includes("[Test] Badminton Club"));
  assert.ok(rendered.includes("Tìm kiếm nhóm..."));
  assert.ok(rendered.includes("md:grid-cols-[240px_1fr]"));
  assert.ok(rendered.includes("md:translate-x-0"));
});
