import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const utils = loadSource("../src/lib/utils.ts").exports;
const gid = "football-zigvy";
function setup(initialState = {}) {
  const fake = createFakeFirestore({
    "members/a": { groupId: gid, name: "Football" }, "members/b": { groupId: "badm-1", name: "Other" },
    "matches/m1": { groupId: gid, date: Timestamp.fromMillis(1792497600000) },
    "matches/m1/shares/a": { groupId: gid, memberId: "a", amount: 10000, status: "PAID", createdAt: Timestamp.now() },
    "matches/m2/shares/b": { groupId: "badm-1", memberId: "b", amount: 90000, status: "PAID", createdAt: Timestamp.now() },
  });
  const toast = () => {};
  const reads = [];
  const getDoc = fake.firestore.getDoc;
  fake.firestore.getDoc = (ref) => { reads.push(ref.path); return getDoc(ref); };
  const host = mountPage("Members", { isLoading: false, ...initialState }, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid }) }, "@/lib/groups": groups,
    "firebase/firestore": fake.firestore, "@/lib/firebase": { db: fake.db }, "@/lib/utils": utils,
    "@/components/ui/use-toast": { useToast: () => ({ toast }) },
    "firebase/app": {}, "firebase/auth": {},
  });
  return { ...fake, host, reads };
}
test("members list query has groupId", async () => {
  const { host, log } = setup();
  await host.page.fetchMembersAndStats();
  assert.deepEqual(Array.from(host.states.get("members"), (member) => member.id), ["a"]);
  assert.ok(log.find((entry) => entry.path === "members").constraints.some((c) => c.field === "groupId" && c.value === gid));
});
test("create member writes groupId", async () => {
  const { host, log } = setup({ newMemberName: "New member" });
  await host.page.handleAddMember();
  const added = log.find((entry) => entry.op === "add");
  assert.equal(added.data.groupId, gid);
  assert.equal(added.data.name, "New member");
});
test("paid history CG query has groupId and totals exclude other groups", async () => {
  const { host, log } = setup();
  await host.page.fetchMembersAndStats();
  assert.equal(host.states.get("memberStats").get("a").totalPaid, 10000);
  assert.equal(host.states.get("memberStats").has("b"), false);
  assert.ok(log.find((entry) => entry.group).constraints.some((c) => c.field === "groupId" && c.value === gid));
});
function findDetails(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(findDetails).find(Boolean);
  if (node.type?.name === "MemberDetails") return node;
  return findDetails(node.props?.children);
}
test("member from other group fetched by id is hidden from history", async () => {
  const { host, reads, log } = setup({ members: [{ id: "b", name: "Other" }] });
  const details = findDetails(host.render());
  assert.ok(details);
  details.type(details.props);
  await host.flush({ runEffects: true });
  assert.ok(reads.includes("members/b"));
  assert.equal(host.states.get("history").length, 0);
  assert.equal(log.some((entry) => entry.group && entry.constraints.some((c) => c.field === "memberId" && c.value === "b")), false);
});
test("same-group member history keeps match dates and scoped CG constraints", async () => {
  const { host, log } = setup({ members: [{ id: "a", name: "Football" }] });
  const details = findDetails(host.render());
  details.type(details.props);
  await host.flush({ runEffects: true });
  assert.equal(host.states.get("history").length, 1);
  const query = log.find((entry) => entry.group && entry.constraints.some((c) => c.field === "memberId"));
  assert.ok(query.constraints.some((c) => c.field === "groupId" && c.value === gid));
});
