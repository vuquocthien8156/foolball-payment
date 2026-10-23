import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "./helpers.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
function roleModule(records = {}) {
  const fake = createFakeFirestore(records);
  return { ...fake, ...loadSource("../src/hooks/useGroupRole.ts", {
    react: {}, "@/contexts/AuthContext": {}, "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore, "@/lib/groups": groups,
  }).exports };
}
test("client group-role matrix matches server; legacy display fallback is Football-only", async () => {
  const host = roleModule({
    "platformAccounts/owner": { role: "owner", status: "active" },
    "platformAccounts/disabled": { role: "owner", status: "disabled" },
    "groupMembers/alpha_manager": { role: "manager", tabs: [] },
    "groupMembers/alpha_admin": { role: "admin", tabs: ["members"] },
    "groupMembers/football-zigvy_legacy": { role: "admin", tabs: ["matches"] },
    "userRoles/legacy": { roles: ["superadmin"] }, "userRoles/old": { roles: ["superadmin"] },
    "groupMembers/alpha_disabled": { role: "manager", tabs: [] },
  });
  assert.equal((await host.resolveClientGroupRole("owner", "beta")).role, "owner");
  assert.equal((await host.resolveClientGroupRole("manager", "alpha")).role, "manager");
  assert.deepEqual(Array.from((await host.resolveClientGroupRole("admin", "alpha")).tabs), ["members"]);
  assert.equal((await host.resolveClientGroupRole("manager", "beta")).role, null);
  assert.equal((await host.resolveClientGroupRole("old", "football-zigvy")).role, "manager");
  assert.equal((await host.resolveClientGroupRole("old", "alpha")).role, null);
  assert.equal((await host.resolveClientGroupRole("legacy", "football-zigvy")).role, "admin");
  assert.equal((await host.resolveClientGroupRole("disabled", "alpha")).role, null);
});
test("actual route guards enforce tabs and send managers to Matches", () => {
  let role = { role: "admin", isManager: false, tabs: ["members"], loading: false };
  const react = { lazy: () => "Lazy", Suspense: "Suspense", useEffect() {} }; react.default = react;
  const loaded = loadSource("../src/App.tsx", {
    react, "react-router-dom": { Navigate: "Navigate", Route: "Route", Routes: "Routes", BrowserRouter: "BrowserRouter" },
    "@tanstack/react-query": { QueryClient: class {}, QueryClientProvider: "QueryClientProvider" },
    "./contexts/AuthContext": { useAuth: () => ({ user: { uid: "staff" }, loading: false }) },
    "./contexts/PWAInstallContext": {}, "./hooks/useGroupRole": { useGroupRole: () => role },
    "./hooks/usePlatformAccount": { usePlatformAccount: () => ({ account: null, loading: false }) },
    "./contexts/GroupContext": { useGroup: () => ({ groupId: "badm-1", group: { sport: "badminton" }, loading: false }), useGroupPath: () => (sub) => groups.groupPath("badm-1", sub) },
    "./lib/groups": groups, "./lib/features": loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports,
    "firebase/auth": {}, "@/lib/firebase": {},
  }).exports;
  const components = [];
  const walk = (tree) => {
    if (!tree || typeof tree !== "object") return;
    if (Array.isArray(tree)) { tree.forEach(walk); return; }
    if (typeof tree.type === "function") components.push(tree);
    walk(tree.props?.element); walk(tree.props?.children);
  };
  walk(loaded.default());
  const member = components.find((node) => node.type.name === "TabGuard" && node.props.tabKey === "members");
  const match = components.find((node) => node.type.name === "TabGuard" && node.props.tabKey === "matches");
  assert.equal(member.type(member.props), member.props.children);
  assert.equal(match.type(match.props).props.to, "/g/badm-1/admin");
  role = { role: "manager", isManager: true, tabs: [], loading: false };
  assert.equal(match.type(match.props), match.props.children);
  const home = components.find((node) => node.type.name === "AdminHomeRedirect");
  assert.equal(home.type().props.to, "/g/badm-1/admin/matches");
});
