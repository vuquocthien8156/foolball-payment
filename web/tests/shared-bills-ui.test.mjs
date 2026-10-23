import assert from "node:assert/strict";
import { test } from "node:test";
import { mountPage, loadSource } from "./helpers.mjs";

test("Bills loads scoped data and creates a bill through the manager API", async () => {
  const calls = [];
  const navigations = [];
  const host = mountPage("Bills", {}, {
    "react-router-dom": { Link: "Link", useNavigate: () => (path) => navigations.push(path) },
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: "netflix" }), useGroupPath: () => (path) => `/g/netflix/${path}` },
    "@/lib/api": { apiRequest: async (method, path, payload) => { calls.push({ method, path, payload }); return method === "POST" ? { id: "new-bill" } : []; } },
    "@/lib/bills": loadSource("../src/lib/bills.ts").exports,
    "@/hooks/use-toast": { toast() {} },
  }, { crypto: { randomUUID: () => "request-one" } });
  await host.flush({ runEffects: true });
  assert.ok(calls.some((call) => call.path === "/groups/netflix/bills/members"));
  await host.page.handleCreate({ title: "Netflix", amountVnd: 260000 });
  assert.equal(calls.at(-1).payload.requestId, "request-one");
  assert.equal(calls.at(-1).path, "/groups/netflix/bills");
  assert.equal(navigations.at(-1), "/g/netflix/admin/bills/new-bill");
});
