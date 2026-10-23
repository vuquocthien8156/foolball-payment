import assert from "node:assert/strict";
import { test } from "node:test";
import { mountPage, loadSource } from "./helpers.mjs";
function loginHost(denied = false, role = "owner", groups = []) {
  const navigation = [], authCalls = [];
  const host = mountPage("PlatformLogin", { email: "demo@test.local", password: "fixture-only" }, {
    "firebase/auth": { signInWithEmailAndPassword: async () => authCalls.push("signIn"), signOut: async () => authCalls.push("signOut") },
    "@/lib/firebase": { auth: {} }, "@/lib/groups": loadSource("../src/lib/groups.ts").exports, "@/lib/api": { apiRequest: async (_method, path) => { if (denied) throw new Error("PLATFORM_ACCESS_DENIED"); return path.endsWith("/groups") ? groups : { role }; } },
    "react-router-dom": { useNavigate: () => (path) => navigation.push(path) }, "@/hooks/use-toast": { toast() {} },
  }, { Error });
  return { host, navigation, authCalls };
}
test("platform login success navigates; denied account signs out", async () => {
  for (const denied of [false, true]) {
    const { host, navigation, authCalls } = loginHost(denied);
    await host.page.handleSubmit({ preventDefault() {} });
    assert.deepEqual(navigation, denied ? [] : ["/platform"]);
    assert.deepEqual(authCalls, denied ? ["signIn", "signOut"] : ["signIn"]);
    assert.equal(host.states.get("password"), "");
  }
});
test("account create sends password once, clears form, and disable uses PATCH", async () => {
  const calls = [], storage = [];
  const host = mountPage("PlatformAccounts", { email: "new@test.local", displayName: "New", password: "fake-password" }, {
    "@/lib/api": { apiRequest: async (method, path, body) => { calls.push({ method, path, body }); return path === "/platform/accounts" && method === "GET" ? [] : { uid: "new", email: "new@test.local" }; } },
    "@/hooks/use-toast": { toast() {} }, "react-router-dom": { Link: "Link" },
  }, { window: { location: { origin: "http://localhost" } }, localStorage: { setItem: (...args) => storage.push(args) }, navigator: { clipboard: { writeText: async () => {} } } });
  await host.flush({ runEffects: true });
  await host.page.handleCreate({ preventDefault() {} });
  assert.equal(calls.find((call) => call.method === "POST").body.password, "fake-password");
  assert.equal(host.states.get("password"), "");
  assert.equal(storage.length, 0);
  assert.ok(!JSON.stringify(host.states.get("createdAccount")).includes("fake-password"));
  await host.page.handleStatus({ uid: "new", status: "active" });
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch.path, "/platform/accounts/new");
  assert.equal(patch.body.status, "disabled");
});
test("PlatformRoute redirects non-owner and unauthenticated user", () => {
  let user = { uid: "user" };
  const react = { lazy: () => "Lazy", Suspense: "Suspense", useEffect() {} }; react.default = react;
  const loaded = loadSource("../src/App.tsx", {
    react, "react-router-dom": { Navigate: "Navigate" }, "firebase/auth": { signOut() {} }, "@/lib/firebase": { auth: {} },
    "@tanstack/react-query": { QueryClient: class {} }, "./contexts/AuthContext": { useAuth: () => ({ user }) },
    "./contexts/PWAInstallContext": {}, "./hooks/useGroupRole": {}, "./contexts/GroupContext": {}, "./lib/groups": {}, "./lib/features": {},
    "./hooks/usePlatformAccount": { usePlatformAccount: () => ({ account: { role: "user" }, loading: false }) },
  }).exports;
  assert.equal(loaded.PlatformRoute({ ownerOnly: true, children: "child" }).props.to, "/platform");
  user = null;
  assert.equal(loaded.PlatformRoute({ children: "child" }).props.to, "/platform/login");
});

test("platform user with exactly one group goes directly to its admin", async () => {
  const { host, navigation } = loginHost(false, "user", [{ id: "badm-1" }]);
  await host.page.handleSubmit({ preventDefault() {} });
  assert.deepEqual(navigation, ["/g/badm-1/admin"]);
});

test("account handoff copies login URL and email separately", async () => {
  const copied = [];
  const host = mountPage("PlatformAccounts", { createdAccount: { email: "fixture@test.local" }, loading: false }, {
    "@/lib/api": { apiRequest: async () => [] }, "@/hooks/use-toast": { toast() {} }, "react-router-dom": { Link: "Link" },
  }, { window: { location: { origin: "https://example.test" } }, navigator: { clipboard: { writeText: async (value) => copied.push(value) } } });
  const find = (tree, label) => {
    if (!tree || typeof tree !== "object") return null;
    if (Array.isArray(tree)) return tree.map((item) => find(item, label)).find(Boolean);
    if (tree.type === "Button" && tree.props.children === label) return tree;
    return find(tree.props?.children, label);
  };
  const tree = host.render();
  const linkButton = find(tree, "Sao chép link đăng nhập");
  const emailButton = find(tree, "Sao chép email");
  assert.ok(linkButton, "Login URL must have a separate copy button");
  assert.ok(emailButton, "Email must have a separate copy button");
  await linkButton.props.onClick();
  await emailButton.props.onClick();
  assert.deepEqual(copied, ["https://example.test/platform/login", "fixture@test.local"]);
});
