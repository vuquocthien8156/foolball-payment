import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createFakeFirestore } from "./fake-firestore.mjs";
const require = createRequire(import.meta.url);
const { run } = require("../../server/scripts/migrate-default-group.js");
const gid = "football-zigvy";
const fixtures = {
  "members/a": { name: "A", authUid: "manager" }, "members/b": { groupId: "other-group" },
  "matches/m1": { totalAmount: 30000 }, "matches/m1/shares/a": { amount: 10000, status: "PAID" },
  "matches/m1/shares/b": { amount: 20000, status: "PENDING", groupId: "other-group" },
  "matches/m1/ratings/a": { score: 5 }, "notifications/n1": { message: "Test" },
  "paymentRequests/123": { totalAmount: 30000 }, "notificationTokens/fake-a": { token: "fake-a" },
  "configs/last_match": { venueName: "Old court" }, "configs/scoringWeights": { goals: 10 },
  "appConfig/publicPasscode": { passcode: "fake-test-only" },
  "userRoles/manager": { roles: ["superadmin"] }, "userRoles/admin": { roles: ["admin"], tabs: ["members"] },
  "userRoles/member": { roles: ["member"] },
};
function setup(extra = {}) {
  const host = createFakeFirestore({ ...fixtures, ...extra });
  const output = [];
  return { ...host, output, migrate: (apply = true) => run({ ...host, args: { ownerUid: "owner", apply }, log: (entry) => output.push(entry) }) };
}
test("dry run writes nothing", async () => {
  const host = setup();
  const before = [...host.records];
  const result = await host.migrate(false);
  assert.deepEqual([...host.records], before);
  assert.equal(host.log.some((entry) => entry.op), false);
  assert.equal(result.written, 0);
  assert.ok(result.proposed > 0);
  assert.ok(host.output.length > 0);
});
test("apply sets groupId only where missing; existing other-group is preserved", async () => {
  const host = setup();
  await host.migrate();
  for (const path of ["members/a", "matches/m1", "matches/m1/shares/a", "matches/m1/ratings/a", "notifications/n1", "paymentRequests/123", "notificationTokens/fake-a"]) {
    assert.equal(host.records.get(path).groupId, gid, path);
    assert.equal(host.log.find((entry) => entry.path === path && entry.op)?.op, "update");
  }
  assert.equal(host.records.get("members/b").groupId, "other-group");
  assert.equal(host.records.get("matches/m1/shares/b").groupId, "other-group");
  assert.equal(host.records.get("matches/m1/shares/a").status, "PAID");
  assert.equal(host.records.get("matches/m1/shares/a").amount, 10000);
});
test("second apply writes 0", async () => {
  const host = setup();
  await host.migrate();
  const count = host.log.filter((entry) => entry.op).length;
  assert.equal((await host.migrate()).written, 0);
  assert.equal(host.log.filter((entry) => entry.op).length, count);
});
test("copies lastMatch only when target missing; leaves global settings and legacy docs", async () => {
  const host = setup();
  await host.migrate();
  assert.deepEqual(host.records.get(`groups/${gid}/settings/lastMatch`), fixtures["configs/last_match"]);
  assert.equal(host.records.has(`groups/${gid}/settings/scoringWeights`), false);
  assert.equal(host.records.has(`groups/${gid}/settings/publicPasscode`), false);
  assert.equal(host.records.has("configs/last_match"), true);
  const existing = setup({ [`groups/${gid}/settings/lastMatch`]: { venueName: "New court" } });
  await existing.migrate();
  assert.equal(existing.records.get(`groups/${gid}/settings/lastMatch`).venueName, "New court");
});
test("userRoles mapping superadmin→manager, admin keeps tabs, member skipped", async () => {
  const host = setup();
  await host.migrate();
  const manager = host.records.get(`groupMembers/${gid}_manager`);
  assert.equal(manager.role, "manager");
  assert.deepEqual(manager.tabs, []);
  assert.equal(manager.memberId, "a");
  assert.equal(manager.uid, "manager");
  assert.equal(manager.groupId, gid);
  assert.deepEqual(host.records.get(`groupMembers/${gid}_admin`).tabs, ["members"]);
  assert.equal(host.records.get(`groupMembers/${gid}_admin`).role, "admin");
  assert.equal(host.records.has(`groupMembers/${gid}_member`), false);
  assert.ok(host.output.some((entry) => String(entry).includes("member")));
});
test("group doc and existing group membership not overwritten", async () => {
  const group = { name: "Kept", sport: "other", ownerUid: "someone" };
  const host = setup({ [`groups/${gid}`]: group, [`groupMembers/${gid}_admin`]: { role: "manager" } });
  await host.migrate();
  assert.deepEqual(host.records.get(`groups/${gid}`), group);
  assert.deepEqual(host.records.get(`groupMembers/${gid}_admin`), { role: "manager" });
});
test("existing group doc without sport gets sport football", async () => {
  const host = setup({ [`groups/${gid}`]: { name: "Kept", ownerUid: "someone" } });
  await host.migrate();
  assert.deepEqual(host.records.get(`groups/${gid}`), { name: "Kept", ownerUid: "someone", sport: "football" });
});
test("batches ≤400 for 900 shares", async () => {
  const host = setup(Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`matches/m2/shares/${i}`, { amount: i }])));
  const sizes = [];
  const original = host.db.batch;
  host.db.batch = () => {
    const batch = original();
    let size = 0;
    for (const op of ["set", "update"]) {
      const method = batch[op];
      batch[op] = (...args) => { size++; return method(...args); };
    }
    const commit = batch.commit;
    batch.commit = async () => { sizes.push(size); await commit(); };
    return batch;
  };
  await host.migrate();
  assert.ok(sizes.length >= 3);
  assert.ok(sizes.every((size) => size <= 400));
});
