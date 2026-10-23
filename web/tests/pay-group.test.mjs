import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const utils = loadSource("../src/lib/utils.ts").exports;
function setup({ exempt = false, group = false } = {}) {
  const gid = "badm-1", date = Timestamp.now();
  const fake = createFakeFirestore({
    "members/a": { groupId: gid, name: "A", isExemptFromPayment: exempt },
    "members/other": { groupId: "football-zigvy", name: "Other" },
    "matches/m1": { groupId: gid, status: "PUBLISHED", date, totalAmount: 10000, teamsConfig: [{ id: "A", name: "A", members: [{ id: "a" }] }] },
    "matches/other": { groupId: "football-zigvy", status: "PUBLISHED", date, totalAmount: 90000 },
    ...(!exempt ? {
      "matches/m1/shares/a": { groupId: gid, memberId: "a", amount: 10000, status: "PENDING", teamId: "A" },
      "matches/other/shares/foreign-parent": { groupId: gid, memberId: "a", amount: 90000, status: "PENDING", teamId: "A" },
      "matches/other/shares/foreign-share": { groupId: "football-zigvy", memberId: "a", amount: 90000, status: "PENDING", teamId: "A" },
    } : {}),
  });
  const storage = [], requests = [];
  const host = mountPage("Pay", { selectedMemberId: "a", isGroupPayment: group, groupMemberIds: ["a"] }, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid, group: { sport: "badminton" } }) }, "@/lib/groups": groups,
    "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore, "@/lib/utils": utils,
    "@/lib/notifications": { fetchStoredMemberToken: async () => null }, "@/hooks/use-toast": { toast() {} },
    "@/contexts/PWAInstallContext": { usePWAInstall: () => ({}) }, "@/components/Rating": { Rating: "Rating" }, recharts: {},
  }, {
    localStorage: { getItem: (key) => { storage.push(key); return null; }, setItem: (key) => storage.push(key) },
    window: { location: { href: "http://localhost/pay" } },
    fetch: async (_url, request) => { requests.push(JSON.parse(request.body)); return { ok: true, text: async () => JSON.stringify({ checkoutUrl: "/mock" }) }; },
  });
  return { ...fake, host, storage, requests };
}
test("pending debts query has groupId; other-group matches ignored in individual and group modes", async () => {
  for (const group of [false, true]) {
    const { host, log } = setup({ group });
    await host.flush({ runEffects: true });
    const debts = host.states.get("unpaidShares");
    assert.equal(debts.length, 1);
    assert.equal(debts[0].matchId, "m1");
    for (const entry of log.filter((entry) => entry.group && entry.path === "shares")) assert.ok(entry.constraints.some((c) => c.field === "groupId" && c.value === "badm-1"));
  }
});
test("localStorage key scoped and checkout payload has groupId", async () => {
  for (const group of [false, true]) {
    const { host, requests, storage } = setup({ group });
    await host.flush({ runEffects: true });
    await host.page.handlePayment();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].groupId, "badm-1");
    host.page.handleMemberChange("a");
    assert.ok(storage.length > 0);
    assert.ok(storage.every((key) => key === "lastSelectedMemberId:badm-1"));
  }
});
test("exempt member rating-only entries unchanged and recent matches scoped", async () => {
  const { host, log } = setup({ exempt: true });
  await host.flush({ runEffects: true });
  assert.equal(host.states.get("unpaidShares").length, 1);
  assert.equal(host.states.get("unpaidShares")[0].isRatingOnly, true);
  const recent = log.find((entry) => entry.path === "matches" && entry.constraints.some((c) => c.field === "date"));
  assert.ok(recent.constraints.some((c) => c.field === "groupId" && c.value === "badm-1"));
  const ratings = log.find((entry) => entry.group && entry.path === "ratings");
  assert.equal(ratings.constraints.some((c) => c.field === "groupId"), false);
});

test("badminton public payment shows costs without team definitions or lineup controls", async () => {
  const { host } = setup({});
  await host.flush({ runEffects: true });
  const text = (tree) => {
    if (Array.isArray(tree)) return tree.map(text).join(" ");
    if (tree && typeof tree === "object") return text(tree.props?.children);
    return typeof tree === "string" ? tree : "";
  };
  const output = text(host.render());
  assert.ok(output.includes("Chi phí buổi chơi"));
  for (const label of ["Xem đội hình", "Số người chia trong đội", "Tổng tiền đội"]) assert.equal(output.includes(label), false, label);
});
