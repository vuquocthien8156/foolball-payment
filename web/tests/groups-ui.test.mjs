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
