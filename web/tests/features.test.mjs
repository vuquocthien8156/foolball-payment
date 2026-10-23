import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const features = loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports;
const { FEATURES, hasFeature } = features;
test("every key true only for football-zigvy + football", () => {
  for (const key of Object.keys(FEATURES)) {
    assert.equal(hasFeature("football-zigvy", { sport: "football" }, key), true);
    assert.equal(hasFeature("fc-abc", { sport: "football" }, key), false);
    assert.equal(hasFeature("football-zigvy", { sport: "badminton" }, key), false);
    assert.equal(hasFeature("football-zigvy", {}, key), false);
  }
});
test("enabled false blocks; no onlyGroups enables another football group", () => {
  const scoring = { sports: ["football"], enabled: true };
  assert.equal(hasFeature("fc-abc", { sport: "football" }, "scoring", { ...FEATURES, scoring }), true);
  assert.equal(hasFeature("football-zigvy", { sport: "football" }, "scoring", { ...FEATURES, scoring: { ...scoring, enabled: false } }), false);
});
test("RequireFeature renders child for football-zigvy and NotFound for badm-1", () => {
  for (const [groupId, sport, expected] of [["football-zigvy", "football", "child"], ["badm-1", "badminton", "Lazy"]]) {
    const react = { lazy: () => "Lazy", Suspense: "Suspense" }; react.default = react;
    const loaded = loadSource("../src/App.tsx", {
      react, "react-router-dom": {}, "@tanstack/react-query": { QueryClient: class {} },
      "./contexts/AuthContext": {}, "./contexts/PWAInstallContext": {}, "./hooks/useGroupRole": {}, "./hooks/usePlatformAccount": {}, "firebase/auth": {}, "@/lib/firebase": {},
      "./contexts/GroupContext": { useGroup: () => ({ groupId, group: { sport }, loading: false }) },
      "./lib/groups": groups, "./lib/features": features,
    }).exports;
    const result = loaded.RequireFeature({ feature: "scoring", children: "child" });
    assert.equal(typeof result === "string" ? result : result.type, expected);
  }
});
function navHost(groupId, sport, loading = false, tabs = ["scoring", "live", "members"]) {
  const fake = createFakeFirestore();
  const navigations = [];
  const group = { groupId, group: { sport }, loading };
  const navigate = (path) => navigations.push(path);
  const groupPath = (sub) => groups.groupPath(groupId, sub);
  const host = mountPage("../components/AdminLayout", {}, {
    "react-router-dom": { NavLink: "NavLink", Outlet: "Outlet", useLocation: () => ({ pathname: groupPath("admin") }), useNavigate: () => navigate },
    "@/contexts/GroupContext": { useGroup: () => group, useGroupPath: () => groupPath },
    "@/lib/features": features, "@/lib/groups": groups,
    "@/contexts/AuthContext": { useAuth: () => ({ user: { uid: "fake" } }) },
    "@/hooks/useGroupRole": { useGroupRole: () => ({ role: "admin", isManager: false, tabs, loading: false }) },
    "@/hooks/usePlatformAccount": { usePlatformAccount: () => ({ account: null }) },
    "firebase/firestore": fake.firestore, "firebase/auth": {}, "@/lib/firebase": { db: fake.db },
    "@/lib/utils": loadSource("../src/lib/utils.ts").exports,
    "@/hooks/use-toast": { toast() {} },
  }, { window: { location: { pathname: groups.groupPath(groupId, "admin") } } });
  return { host, navigations };
}
function links(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(links);
  return [...(tree.type === "NavLink" ? [tree.props.to] : []), ...links(tree.props?.children)];
}
test("nav has Scoring/Live for football-zigvy, not for badm-1", () => {
  for (const [gid, sport, shown] of [["football-zigvy", "football", true], ["badm-1", "badminton", false]]) {
    const { host } = navHost(gid, sport);
    const targets = links(host.render());
    assert.equal(targets.includes(groups.groupPath(gid, "admin/scoring")), shown);
    assert.equal(targets.includes(groups.groupPath(gid, "admin/live")), shown);
    assert.equal(targets.includes(groups.groupPath(gid, "admin/members")), true);
  }
});
test("auto-redirect skips scoring/live for badm-1 and waits for group load", async () => {
  const ready = navHost("badm-1", "badminton");
  await ready.host.flush({ runEffects: true });
  assert.deepEqual(ready.navigations, ["/g/badm-1/admin/members"]);
  const loading = navHost("football-zigvy", "football", true);
  await loading.host.flush({ runEffects: true });
  assert.deepEqual(loading.navigations, []);
  const hiddenOnly = navHost("badm-1", "badminton", false, ["scoring", "live"]);
  await hiddenOnly.host.flush({ runEffects: true });
  assert.deepEqual(hiddenOnly.navigations, []);
});
