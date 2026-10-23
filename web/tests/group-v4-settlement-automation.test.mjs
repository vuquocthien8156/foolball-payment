import test from "node:test";
import assert from "node:assert/strict";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { startRouter } from "./http-harness.mjs";
import { loadCjs } from "./load-cjs.mjs";

test("Group v4: Payout settings, match payout settlement, templates, and schedule automation", async (t) => {
  const fake = createFakeFirestore({
    "groups/badminton-club": {
      name: "Badminton Club",
      sport: "badminton",
      status: "active",
      ownerUid: "owner-uid",
      ownerEmail: "owner@test.local",
    },
    "groupMembers/badminton-club_owner-uid": {
      groupId: "badminton-club",
      uid: "owner-uid",
      role: "owner",
      tabs: "*",
    },
    "platformAccounts/owner-uid": {
      role: "user",
      status: "active",
      email: "owner@test.local",
      displayName: "Owner",
    },
    "members/mem-1": {
      groupId: "badminton-club",
      name: "Player One",
      autoAttendance: true,
      inactive: false,
    },
    "members/mem-2": {
      groupId: "badminton-club",
      name: "Player Two",
      autoAttendance: false,
      inactive: false,
    },
    "matches/match-123": {
      groupId: "badminton-club",
      totalAmount: 400000,
      status: "PUBLISHED",
      payoutStatus: "COLLECTING",
    },
  });

  const fakeAuth = createFakeAuth({
    users: [
      { uid: "owner-uid", email: "owner@test.local" },
      { uid: "other-uid", email: "other@test.local" },
    ],
  });

  const { createGroupRouter } = loadCjs("../../server/lib/groupRoutes.js", {
    "./auth": loadCjs("../../server/lib/auth.js"),
    "./groups": loadCjs("../../server/lib/groups.js"),
    "./scheduledMatches": loadCjs("../../server/lib/scheduledMatches.js", {
      "./groups": loadCjs("../../server/lib/groups.js"),
    }),
  });

  const host = await startRouter(
    createGroupRouter({
      db: fake.db,
      auth: fakeAuth.auth,
      FieldValue: fake.FieldValue,
      slack: { postToSlackDetailed: async () => ({ ok: true }) },
      env: {},
    })
  );
  t.after(host.close);

  async function request(method, path, body, uid = "owner-uid") {
    const res = await fetch(host.url + path, {
      method,
      headers: {
        Authorization: `Bearer uid:${uid}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = res.status !== 204 ? await res.json().catch(() => null) : null;
    return { status: res.status, data };
  }

  // 1. Payout Settings (VietQR & Bank Account)
  const putPayoutRes = await request("PUT", "/badminton-club/settings/payout", {
    bankBin: "970422",
    bankName: "MBBank",
    accountNumber: "0987654321",
    accountHolder: "Nguyen Van A",
    qrCodeUrl: "https://custom-qr.url",
  });
  assert.equal(putPayoutRes.status, 200);

  const getPayoutRes = await request("GET", "/badminton-club/settings/payout");
  assert.equal(getPayoutRes.status, 200);
  assert.equal(getPayoutRes.data.bankName, "MBBank");
  assert.equal(getPayoutRes.data.accountHolder, "NGUYEN VAN A");
  assert.equal(getPayoutRes.data.accountNumber, "0987654321");

  // 2. Match Payout Status (Mark as PAID_OUT)
  const payoutRes = await request("POST", "/badminton-club/matches/match-123/payout", {
    payoutStatus: "PAID_OUT",
    note: "Đã chuyển khoản hoàn tiền sân",
  });
  assert.equal(payoutRes.status, 200);
  assert.equal(payoutRes.data.payoutStatus, "PAID_OUT");

  const matchDoc = fake.records.get("matches/match-123");
  assert.equal(matchDoc.payoutStatus, "PAID_OUT");
  assert.equal(matchDoc.payoutNote, "Đã chuyển khoản hoàn tiền sân");
  assert.equal(matchDoc.paidOutBy, "owner-uid");
  assert.ok(matchDoc.paidOutAt);

  // Reverse back to COLLECTING
  const revertRes = await request("POST", "/badminton-club/matches/match-123/payout", {
    payoutStatus: "COLLECTING",
  });
  assert.equal(revertRes.status, 200);
  assert.equal(fake.records.get("matches/match-123").payoutStatus, "COLLECTING");
  assert.equal(fake.records.get("matches/match-123").paidOutAt, null);

  // 3. Match Templates CRUD
  const createTplRes = await request("POST", "/badminton-club/templates", {
    name: "Sân Bình Thạnh 19h",
    venueName: "Sân Cầu Lông Bình Thạnh",
    totalAmount: 300000,
    kickoffTime: "19:00",
    attendanceCloseHours: 6,
  });
  assert.equal(createTplRes.status, 201);
  const templateId = createTplRes.data.id;
  assert.ok(templateId);

  const listTplRes = await request("GET", "/badminton-club/templates");
  assert.equal(listTplRes.status, 200);
  assert.equal(listTplRes.data.length, 1);
  assert.equal(listTplRes.data[0].venueName, "Sân Cầu Lông Bình Thạnh");

  // 4. Automated Scheduled Attendance Settings & Run-now
  const putScheduleRes = await request("PUT", "/badminton-club/settings/schedule", {
    enabled: true,
    dayOfWeek: 2, // Tuesday
    createHour: 9,
    matchDayOfWeek: 4, // Thursday
    matchTime: "19:00",
    templateId,
  });
  assert.equal(putScheduleRes.status, 200);

  const getScheduleRes = await request("GET", "/badminton-club/settings/schedule");
  assert.equal(getScheduleRes.status, 200);
  assert.equal(getScheduleRes.data.enabled, true);
  assert.equal(getScheduleRes.data.templateId, templateId);

  // Test Run-Now
  const runNowRes = await request("POST", "/badminton-club/settings/schedule/run-now", {});
  assert.equal(runNowRes.status, 201);
  const createdMatchId = runNowRes.data.matchId;
  assert.ok(createdMatchId);

  const createdMatch = fake.records.get(`matches/${createdMatchId}`);
  assert.ok(createdMatch);
  assert.equal(createdMatch.groupId, "badminton-club");
  assert.equal(createdMatch.status, "PENDING");
  assert.equal(createdMatch.venueName, "Sân Cầu Lông Bình Thạnh");

  // Check auto-attendance populated for Player One (mem-1) but not mem-2
  const attMem1 = fake.records.get(`matches/${createdMatchId}/attendance/mem-1`);
  assert.ok(attMem1);
  assert.equal(attMem1.memberName, "Player One");
  const attMem2 = fake.records.get(`matches/${createdMatchId}/attendance/mem-2`);
  assert.equal(attMem2, undefined);

  // 5. Delete template
  const delTplRes = await request("DELETE", `/badminton-club/templates/${templateId}`);
  assert.equal(delTplRes.status, 200);
  const listAfterDel = await request("GET", "/badminton-club/templates");
  assert.equal(listAfterDel.data.length, 0);
});
