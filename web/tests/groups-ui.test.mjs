import assert from "node:assert/strict";
import { test } from "node:test";
import { mountPage, loadSource } from "./helpers.mjs";
test("group creation requires a sport and navigates to new admin", async () => {
  const calls = [], navigation = [];
  const host = mountPage("Groups", { name: "New group" }, {
    "@/lib/api": { apiRequest: async (method, path, body) => { calls.push({ method, path, body }); return method === "GET" ? [] : { id: "new-aaaa" }; } },
    "@/hooks/use-toast": { toast() {} }, "@/hooks/usePlatformAccount": { usePlatformAccount: () => ({ account: { role: "owner" } }) },
    "@/lib/groups": loadSource("../src/lib/groups.ts").exports,
    "react-router-dom": { Link: "Link", useNavigate: () => (path) => navigation.push(path) },
    "firebase/auth": { signOut: async () => {} }, "@/lib/firebase": { auth: {} },
  });
  await host.flush({ runEffects: true });
  await host.page.handleCreate({ preventDefault() {} });
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  host.states.set("sport", "badminton"); host.render();
  await host.page.handleCreate({ preventDefault() {} });
  assert.equal(calls.find((call) => call.method === "POST").body.sport, "badminton");
  assert.deepEqual(navigation, ["/g/new-aaaa/admin"]);
});

test("Groups page isolates test groups in collapsible section and toggles test flag", async () => {
  const calls = [];
  const initialGroups = [
    { id: "main-1", name: "Main Badminton", sport: "badminton", kind: "sports", status: "active", role: "owner", isTest: false },
    { id: "test-1", name: "[Test] Badminton Club", sport: "badminton", kind: "sports", status: "active", role: "owner", isTest: true },
  ];
  const host = mountPage("Groups", { loading: false, groups: initialGroups }, {
    "@/lib/api": {
      apiRequest: async (method, path, body) => {
        calls.push({ method, path, body });
        if (method === "GET" && path === "/platform/groups") return initialGroups;
        if (method === "PATCH") return { ok: true };
        return {};
      },
    },
    "@/hooks/use-toast": { toast() {} },
    "@/hooks/usePlatformAccount": { usePlatformAccount: () => ({ account: { role: "owner" } }) },
    "@/lib/groups": loadSource("../src/lib/groups.ts").exports,
    "react-router-dom": { Link: "Link", useNavigate: () => () => {} },
    "firebase/auth": { signOut: async () => {} },
    "@/lib/firebase": { auth: {} },
  });
  await host.flush({ runEffects: true });
  const rendered = JSON.stringify(host.render());
  assert.ok(rendered.includes("Nhóm Thử Nghiệm (Test)"));
  assert.ok(rendered.includes(" nhóm"));

  // Expanding test section renders the group card and its "Thử nghiệm" badge
  host.states.set("isTestSectionOpen", true);
  const expanded = JSON.stringify(host.render());
  assert.ok(expanded.includes("Thử nghiệm"));

  // Toggle test-1 to non-test group
  await host.page.handleToggleTestGroup(initialGroups[1]);
  const patchCall = calls.find((c) => c.method === "PATCH" && c.path === "/platform/groups/test-1");
  assert.ok(patchCall);
  assert.equal(patchCall.body.isTest, false);
});

