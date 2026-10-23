import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const { run: migrate } = require("../../server/scripts/migrate-default-group.js");
const { run: seed } = require("../../server/scripts/seed-emulator.js");
const config = JSON.parse(fs.readFileSync(new URL("../../firestore.indexes.json", import.meta.url), "utf8"));
const index = (collectionGroup, queryScope, fields) => ({ collectionGroup, queryScope, fields: fields.map((field) => ({ fieldPath: field.replace(/-$/, ""), order: field.endsWith("-") ? "DESCENDING" : "ASCENDING" })) });
const required = [
  ...[["groupId", "status", "date-"], ["groupId", "status", "date"], ["groupId", "status", "createdAt-"], ["groupId", "date-"], ["groupId", "date"]].map((fields) => index("matches", "COLLECTION", fields)),
  index("members", "COLLECTION", ["groupId", "name"]), index("notifications", "COLLECTION", ["groupId", "createdAt-"]),
  ...[["groupId", "memberId", "status"], ["groupId", "memberId", "status", "createdAt-"], ["groupId", "memberId", "status", "channel"], ["groupId", "status"]].map((fields) => index("shares", "COLLECTION_GROUP", fields)),
];
const shape = ({ collectionGroup, queryScope, fields }) => JSON.stringify({ collectionGroup, queryScope, fields });
test("each listed group index exists and no entries are duplicated", () => {
  const shapes = config.indexes.map(shape);
  assert.equal(new Set(shapes).size, shapes.length);
  for (const entry of required) assert.ok(shapes.includes(shape(entry)), shape(entry));
  assert.equal(config.indexes.filter((entry) => entry.collectionGroup === "ratings").length, 0);
  const groupOverride = config.fieldOverrides.find((entry) => entry.collectionGroup === "shares" && entry.fieldPath === "groupId");
  assert.ok(groupOverride);
  assert.deepEqual(groupOverride.indexes, [{ order: "ASCENDING", queryScope: "COLLECTION" }, { order: "ASCENDING", queryScope: "COLLECTION_GROUP" }]);
  const overrides = config.fieldOverrides.map(({ collectionGroup, fieldPath }) => `${collectionGroup}/${fieldPath}`);
  assert.equal(new Set(overrides).size, overrides.length);
  for (const path of ["shares/matchId", "shares/payosOrderCode", "shares/status", "ratings/ratedByMemberId"]) assert.ok(overrides.includes(path));
});
test("migration rehearsal preserves money and paid/unpaid share counts, then writes zero", async () => {
  const fake = createFakeFirestore();
  const auth = { getUserByEmail: async () => ({ uid: "demo-owner" }) };
  await seed({ ...fake, auth, Timestamp, args: ["--legacy"], env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }, log() {} });
  // Combined regression fixtures: legacy and scoped records, duplicate share IDs,
  // paid/unpaid debts, CG ratings, notification/payment metadata and staff roles.
  for (const [path, data] of Object.entries({
    "matches/legacy-regression": { status: "PUBLISHED", totalAmount: 30000 },
    "matches/legacy-regression/shares/same-id": { memberId: "legacy-member", matchId: "legacy-regression", amount: 10000, status: "PAID" },
    "matches/badm-published/shares/same-id": { groupId: "badm-1", memberId: "badm-member-1", matchId: "badm-published", amount: 20000, status: "PENDING" },
    "matches/legacy-regression/ratings/r1": { ratedByMemberId: "legacy-member", playerRatings: [], mvpPlayerId: "legacy-member" },
    "members/legacy-member": { name: "Legacy", authUid: "demo-owner" },
    "notifications/n1": { message: "Fixture", matchId: "legacy-regression" },
    "paymentRequests/123": { totalAmount: 10000, status: "PAID", sharePaths: ["matches/legacy-regression/shares/same-id"] },
    "userRoles/staff": { roles: ["admin"], tabs: ["matches", "members"] },
    "userRoles/member": { roles: ["member"] },
    "configs/last_match": { teamCount: 2, teamsConfig: [] },
    "configs/scoringWeights": { goal: 1 }, "appConfig/publicPasscode": { passcode: "fake" },
  })) await fake.db.doc(path).set(data);
  const financialState = () => {
    const shares = [...fake.records].filter(([path]) => /\/shares\//.test(path)).map(([, data]) => data);
    return {
      total: shares.reduce((sum, share) => sum + share.amount, 0), paid: shares.filter((share) => share.status === "PAID").length,
      pending: shares.filter((share) => share.status === "PENDING").length,
      matches: [...fake.records].filter(([path]) => /^matches\/[^/]+$/.test(path)).reduce((sum, [, data]) => sum + data.totalAmount, 0),
      paidRequests: [...fake.records].filter(([path]) => path.startsWith("paymentRequests/")).reduce((sum, [, data]) => sum + data.totalAmount, 0),
    };
  };
  const before = financialState();
  const first = await migrate({ ...fake, args: { ownerUid: "demo-owner", apply: true }, log() {} });
  assert.ok(first.written > 0);
  assert.deepEqual(financialState(), before);
  const second = await migrate({ ...fake, args: { ownerUid: "demo-owner", apply: true }, log() {} });
  assert.equal(second.written, 0);
  assert.ok(second.summary.every((entry) => entry.missingGroupId === 0));
  assert.equal(fake.records.get("members/badm-member-1").groupId, "badm-1");
});
