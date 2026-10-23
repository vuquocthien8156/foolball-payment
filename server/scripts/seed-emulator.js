const ADMIN_EMAIL = "admin@test.local";
const ADMIN_PASSWORD = "Local-demo-football-2026!";
const ADMIN_UID = "demo-football-admin";

function requireEmulators(env) {
  for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
    if (!env[name]) throw new Error(`${name} must be set; emulator seeding only.`);
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(env[name])) {
      throw new Error(`${name} must point to localhost.`);
    }
  }
}

async function run({ db, auth, args = [], log = console.log, env = process.env, Timestamp }) {
  requireEmulators(env);
  if (args.some((arg) => !["--migrated", "--legacy"].includes(arg)) || (args.includes("--migrated") && args.includes("--legacy"))) {
    throw new Error("Use --migrated (default) or --legacy.");
  }
  let user;
  try { user = await auth.getUserByEmail(ADMIN_EMAIL); }
  catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ uid: ADMIN_UID, email: ADMIN_EMAIL, password: ADMIN_PASSWORD, displayName: "Demo Admin" });
  }
  await db.doc(`userRoles/${user.uid}`).set({ roles: ["superadmin"] });
  const date = (value) => Timestamp ? Timestamp.fromDate(new Date(value)) : new Date(value);
  const createdAt = date("2026-10-20T00:00:00Z");
  for (const [groupId, prefix, sport, name] of [
    ["football-zigvy", "football", "football", "Football Zigvy Group"],
    ["badm-1", "badm", "badminton", "Demo Badminton"],
  ]) {
    const scope = args.includes("--legacy") && groupId === "football-zigvy" ? {} : { groupId };
    await db.doc(`groups/${groupId}`).set({ name, sport, ownerUid: user.uid, status: "active", payoutEnabled: false, createdBy: user.uid, createdAt, updatedAt: createdAt });
    const members = Array.from({ length: 6 }, (_, index) => ({ id: `${prefix}-member-${index + 1}`, name: `Demo ${prefix} ${index + 1}` }));
    for (const [index, member] of members.entries()) {
      const token = `fake-${member.id}`;
      await db.doc(`members/${member.id}`).set({ ...scope, name: member.name, autoAttendance: index === 0, isExemptFromPayment: false,
        ...(index === 0 && prefix === "football" ? { authUid: user.uid, loginEmail: ADMIN_EMAIL, loginEnabled: true } : {}), fcmToken: token, createdAt });
      await db.doc(`notificationTokens/${prefix}-token-${index + 1}`).set({ ...scope, memberId: member.id, token, updatedAt: createdAt });
    }
    for (const status of ["PENDING", "PUBLISHED"]) {
      const matchId = `${prefix}-${status.toLowerCase()}`;
      const teamsConfig = ["A", "B"].map((id, index) => ({ id, name: `Team ${id}`, percent: 50, members: members.slice(index * 3, index * 3 + 3), totalAmount: 30000 }));
      await db.doc(`matches/${matchId}`).set({ ...scope, status, date: date(status === "PENDING" ? "2026-10-21T12:00:00Z" : "2026-10-19T12:00:00Z"),
        createdAt, attendanceCloseHours: 0, venueName: "Demo court", isDeleted: false, teamCount: 2,
        teamsConfig, totalAmount: 60000, expenseItems: [{ id: "court", description: "Court", amount: 60000, type: "SHARED", exemptMemberIds: [], teamPercents: { A: 50, B: 50 } }] });
      if (status === "PUBLISHED") for (const [index, member] of members.entries()) {
        await db.doc(`matches/${matchId}/shares/${member.id}`).set({ ...scope, matchId, memberId: member.id, amount: 10000,
          status: index === 0 ? "PAID" : "PENDING", teamId: index < 3 ? "A" : "B", createdAt });
      }
    }
  }
  log(`Seeded demo-football (${args.includes("--legacy") ? "legacy" : "migrated"}); local fixtures only.`);
  return { uid: user.uid };
}

async function main() {
  requireEmulators(process.env);
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: "demo-football" });
  await run({ db: admin.firestore(), auth: admin.auth(), Timestamp: admin.firestore.Timestamp, args: process.argv.slice(2) });
}

module.exports = { run };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
