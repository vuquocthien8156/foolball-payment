import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";

const require = createRequire(import.meta.url);
const groups = require("../../server/lib/groups.js");

async function setup(t) {
  const fake = createFakeFirestore({
    "platformAccounts/owner": { role: "owner", status: "active", email: "admin@test.local", displayName: "Super Admin" },
    "platformAccounts/manager": { role: "user", status: "active", email: "mgr@test.local", displayName: "Manager" },
    "groups/club": {
      name: "Badminton Club",
      sport: "badminton",
      status: "active",
      ownerUid: "manager",
      payoutBankBin: "970422",
      payoutBankName: "MBBank",
      payoutAccountNumber: "123456789",
      payoutAccountHolder: "Le Van B",
    },
    "groupMembers/club_manager": { uid: "manager", groupId: "club", role: "manager" },
    "members/club_adv": {
      groupId: "club",
      name: "Thien Bong (Advance Payer)",
    },
    "members/club_other": {
      groupId: "club",
      name: "Nguyen Van C",
    },
    // Match 1: Court fee 400k. Advance payer has share 76.5k (PENDING). Net should be 323.5k.
    "matches/match-net-offset": {
      groupId: "club",
      totalAmount: 400000,
      paidByMemberId: "club_adv",
      paidByMemberName: "Thien Bong (Advance Payer)",
      status: "PUBLISHED",
      date: new Date().toISOString(),
    },
    "matches/match-net-offset/shares/share-adv": {
      groupId: "club",
      matchId: "match-net-offset",
      memberId: "club_adv",
      amount: 76500,
      status: "PENDING",
    },
    "matches/match-net-offset/shares/share-other": {
      groupId: "club",
      matchId: "match-net-offset",
      memberId: "club_other",
      amount: 76500,
      status: "PAID",
      channel: "PAYOS",
    },
    // Match 2: Court fee 300k. Advance payer has share 50k, but PAID via PAYOS. Net should be full 300k.
    "matches/match-payos-share": {
      groupId: "club",
      totalAmount: 300000,
      paidByMemberId: "club_adv",
      paidByMemberName: "Thien Bong (Advance Payer)",
      status: "PUBLISHED",
      date: new Date().toISOString(),
    },
    "matches/match-payos-share/shares/share-adv-2": {
      groupId: "club",
      matchId: "match-payos-share",
      memberId: "club_adv",
      amount: 50000,
      status: "PAID",
      channel: "PAYOS",
    },
    // Super Admin group where manager is only a linked member
    "groups/football-super": {
      name: "Football Super Group",
      sport: "football",
      status: "active",
      ownerUid: "owner",
    },
    "members/super_mem_manager": {
      groupId: "football-super",
      name: "Manager Linked Member",
      accountUid: "manager",
    },
    "members/super_mem_other": {
      groupId: "football-super",
      name: "Other Player",
      accountUid: "other_uid",
    },
    "matches/match-super-mgr": {
      groupId: "football-super",
      totalAmount: 550000,
      paidByMemberId: "super_mem_manager",
      payoutStatus: "PAID_OUT",
      payoutGrossAmount: 550000,
      payoutNetAmount: 550000,
      date: new Date().toISOString(),
      paidOutAt: new Date().toISOString(),
    },
    "matches/match-super-other": {
      groupId: "football-super",
      totalAmount: 400000,
      paidByMemberId: "super_mem_other",
      payoutStatus: "PAID_OUT",
      payoutGrossAmount: 400000,
      payoutNetAmount: 400000,
      date: new Date().toISOString(),
      paidOutAt: new Date().toISOString(),
    },
  });

  const { createPlatformRouter } = loadCjs("../../server/lib/platformRoutes.js", {
    "./auth": loadCjs("../../server/lib/auth.js"),
    "./groups": groups,
    "node:crypto": { randomInt: () => 0 },
  });

  const host = await startRouter(
    createPlatformRouter({
      db: fake.db,
      auth: createFakeAuth().auth,
      FieldValue: fake.FieldValue,
    })
  );
  t.after(host.close);

  return {
    ...fake,
    async request(method, path, body, uid = "owner") {
      const res = await fetch(host.url + path, {
        method,
        headers: {
          Authorization: `Bearer uid:${uid}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    },
  };
}

test("Automated Net Offset: deducts payer unpaid share and supports history retrieval", async (t) => {
  const host = await setup(t);

  // 1. Overview computes Net Offset
  const overviewRes = await host.request("GET", "/settlement/overview", null, "owner");
  assert.equal(overviewRes.status, 200);

  const groupItem = overviewRes.data.groups.find((g) => g.groupId === "club");
  assert.ok(groupItem, "Group should be found in overview");

  const match1 = groupItem.pendingMatches.find((m) => m.id === "match-net-offset");
  assert.ok(match1);
  assert.equal(match1.grossAmount, 400000);
  assert.equal(match1.payerShareAmount, 76500);
  assert.equal(match1.payerSharePaid, false);
  assert.equal(match1.netPayoutAmount, 323500); // 400,000 - 76,500 = 323,500

  const match2 = groupItem.pendingMatches.find((m) => m.id === "match-payos-share");
  assert.ok(match2);
  assert.equal(match2.grossAmount, 300000);
  assert.equal(match2.payerShareAmount, 50000);
  assert.equal(match2.payerSharePaid, true);
  assert.equal(match2.netPayoutAmount, 300000); // PayOS paid, full gross amount

  // Total for club should be 323,500 + 300,000 = 623,500
  assert.equal(groupItem.pendingAmount, 623500);

  // 2. Batch settle single match records payout snapshot
  const settleRes = await host.request(
    "POST",
    "/settlement/batch-settle",
    {
      groupId: "club",
      matchIds: ["match-net-offset"],
      note: "Test net settlement",
    },
    "owner"
  );
  assert.equal(settleRes.status, 200);

  // Verify match in DB was updated with net snapshot
  const settledMatch = host.records.get("matches/match-net-offset");
  assert.equal(settledMatch.payoutStatus, "PAID_OUT");
  assert.equal(settledMatch.payoutGrossAmount, 400000);
  assert.equal(settledMatch.payoutPayerShareAmount, 76500);
  assert.equal(settledMatch.payoutNetAmount, 323500);
  assert.equal(settledMatch.paidOutBy, "owner");
  assert.ok(settledMatch.paidOutAt);

  // 3. History endpoint returns settled match
  const historyRes = await host.request("GET", "/settlement/history", null, "owner");
  assert.equal(historyRes.status, 200);
  assert.ok(Array.isArray(historyRes.data.history));

  const historyMatch = historyRes.data.history.find((h) => h.id === "match-net-offset");
  assert.ok(historyMatch);
  assert.equal(historyMatch.grossAmount, 400000);
  assert.equal(historyMatch.payerShareAmount, 76500);
  assert.equal(historyMatch.netPayoutAmount, 323500);
  assert.equal(historyMatch.recipientName, "Thien Bong (Advance Payer)");
  assert.equal(historyMatch.paidByMemberName, "Thien Bong (Advance Payer)");

  // 4. Manager requests settlement history:
  // Should see their own group's matches, PLUS match-super-mgr from Super Admin's group!
  // Should NOT see match-super-other!
  const mgrHistoryRes = await host.request("GET", "/settlement/history", null, "manager");
  assert.equal(mgrHistoryRes.status, 200);
  const mgrHistory = mgrHistoryRes.data.history;
  assert.ok(Array.isArray(mgrHistory));

  const crossGroupMatch = mgrHistory.find((h) => h.id === "match-super-mgr");
  assert.ok(crossGroupMatch, "Manager must see matches they fronted in Super Admin's group");
  assert.equal(crossGroupMatch.isRecipientCurrentUser, true);
  assert.equal(crossGroupMatch.isManagedByCurrentUser, false);
  assert.equal(crossGroupMatch.paidByMemberName, "Manager Linked Member");

  const otherMatch = mgrHistory.find((h) => h.id === "match-super-other");
  assert.equal(otherMatch, undefined, "Manager must NOT see other members' matches in foreign groups");
});
