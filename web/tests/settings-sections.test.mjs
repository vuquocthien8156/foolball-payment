import assert from "node:assert/strict";
import { test } from "node:test";
import { mountPage, loadSource } from "./helpers.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const features = loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports;
const text = (tree) => Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : typeof tree === "string" ? tree : "";

test("shared-bill Settings groups integrations and never requests sports configuration", async () => {
  const fake = createFakeFirestore();
  const calls = [];
  const toast = () => {};
  const host = mountPage("Config", {}, {
    "@/lib/groups": groups, "@/lib/features": features, "react-router-dom": { Link: "Link" },
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: "netflix", group: { name: "Netflix", kind: "shared_bills" } }) },
    "@/contexts/AuthContext": { useAuth: () => ({ user: { uid: "owner" } }) },
    "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore,
    "@/components/ui/use-toast": { useToast: () => ({ toast }) },
    "@/lib/api": { apiRequest: async (method, path) => { calls.push(path); return {}; } },
  });
  await host.flush({ runEffects: true });
  const rendered = text(host.render());
  for (const section of ["Thông tin chung", "Thu tiền và tài khoản nhận", "Tích hợp", "Tự động hóa"]) assert.ok(rendered.includes(section));
  assert.equal(rendered.includes("Lịch tạo trận tự động"), false);
  assert.equal(calls.some((path) => /templates|schedule/.test(path)), false);
  assert.equal(fake.log.some((entry) => entry.path === "appConfig/publicPasscode"), false);
});
