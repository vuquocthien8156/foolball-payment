import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;

function groupHost(groupId, records = {}) {
  const fake = createFakeFirestore(records);
  let state;
  let effect;
  const react = {
    createContext: () => ({ Provider: "Provider" }), useContext: () => state,
    useState: (initial) => { if (state === undefined) state = initial; return [state, (value) => { state = value; }]; },
    useEffect: (fn) => { effect = fn; }, useCallback: (fn) => fn,
  };
  const loaded = loadSource("../src/contexts/GroupContext.tsx", {
    react, "react-router-dom": { useParams: () => ({ groupId }) },
    "firebase/firestore": fake.firestore, "@/lib/firebase": { db: fake.db },
    "@/lib/groups": groups, "@/pages/NotFound": { default: "NotFound" },
  }).exports;
  return { ...fake, loaded, render: () => loaded.GroupProvider({ children: "child" }),
    async settle() { effect(); await new Promise((resolve) => setImmediate(resolve)); return this.render(); } };
}

test("GroupProvider rejects invalid id without a read", async () => {
  const host = groupHost("-bad");
  assert.equal(host.render().type, "NotFound");
  await host.settle();
  assert.equal(host.records.size, 0);
});
test("default group works without doc", async () => {
  const host = groupHost("football-zigvy");
  assert.equal(host.render().props.value.loading, true);
  const result = await host.settle();
  assert.equal(result.props.value.group.name, "Football Zigvy Group");
  assert.equal(result.props.value.group.sport, "football");
  assert.equal(result.props.value.notFound, false);
  assert.equal(result.props.value.loading, false);
});
test("unknown non-default and archived group → notFound", async () => {
  for (const records of [{}, { "groups/badm-1": { name: "Archived", sport: "badminton", status: "archived" } }]) {
    const host = groupHost("badm-1", records);
    host.render();
    assert.equal((await host.settle()).type, "NotFound");
  }
});
test("active group loads with route groupId", async () => {
  const host = groupHost("badm-1", { "groups/badm-1": { name: "Badminton", sport: "badminton", status: "active" } });
  host.render();
  const result = await host.settle();
  assert.equal(result.props.value.groupId, "badm-1");
  assert.equal(result.props.value.group.name, "Badminton");
});
test("LegacyRedirect keeps query", () => {
  const react = { lazy: () => "Lazy", Suspense: "Suspense" };
  react.default = react;
  const loaded = loadSource("../src/App.tsx", {
    react, "react-router-dom": { Navigate: "Navigate", useLocation: () => ({ pathname: "/public/team-locked", search: "?token=fake&matchId=m1" }) },
    "@tanstack/react-query": { QueryClient: class {} },
    "./contexts/AuthContext": { useAuth() {} }, "./contexts/PWAInstallContext": {}, "./hooks/useGroupRole": {}, "./hooks/usePlatformAccount": {}, "firebase/auth": {}, "@/lib/firebase": {},
    "./contexts/GroupContext": {}, "./lib/groups": groups, "./lib/features": {},
  }).exports;
  const result = loaded.LegacyRedirect();
  assert.equal(result.type, "Navigate");
  assert.equal(result.props.to, "/g/football-zigvy/public/team-locked?token=fake&matchId=m1");
  assert.equal(result.props.replace, true);
});

test("old group login redirects to platform login with query and no member reads", () => {
  const loaded = loadSource("../src/pages/Login.tsx", {
    "react-router-dom": { Navigate: "Navigate", useLocation: () => ({ search: "?x=1" }) },
  }).exports;
  assert.equal(loaded.default().props.to, "/platform/login?x=1");
});
