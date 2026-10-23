import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { mountPage, loadSource } from "./helpers.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
test("member edits change player fields while preserving stored legacy identity", async () => {
  const identity = { authUid: "existing-owner", loginEmail: "owner@test.local", loginEnabled: true, loginRole: "superadmin" };
  const fake = createFakeFirestore({ "members/a": { groupId: "football-zigvy", name: "Old", ...identity } });
  const host = mountPage("Members", { isLoading: false }, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: "football-zigvy" }) },
    "@/lib/groups": loadSource("../src/lib/groups.ts").exports,
    "firebase/firestore": fake.firestore, "@/lib/firebase": { db: fake.db },
    "@/lib/utils": loadSource("../src/lib/utils.ts").exports,
    "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) },
  });
  await host.page.handleUpdateMember("a", { name: "Updated", nickname: "Player", authUid: "changed", loginRole: "admin", loginEnabled: false });
  const saved = fake.records.get("members/a");
  assert.equal(saved.name, "Updated");
  assert.equal(saved.nickname, "Player");
  for (const [key, value] of Object.entries(identity)) assert.equal(saved[key], value);
  assert.ok(fake.log.filter((entry) => entry.op).every((entry) => entry.path.startsWith("members/")));
});
test("no member credential controls, client Auth creation or staff-login API", () => {
  const members = fs.readFileSync(new URL("../src/pages/Members.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(members, /createUserWithEmailAndPassword|firebase\/auth|firebase\/app|userRoles|edit-login|Login bật/);
  const server = fs.readFileSync(new URL("../../server/lib/groupRoutes.js", import.meta.url), "utf8");
  assert.doesNotMatch(server, /staff-logins/);
});
