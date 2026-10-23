import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCjs } from "./load-cjs.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
const invoke = (fake, args) => loadCjs("../../server/scripts/seed-owner.js").run({ db: fake.db, args: { uid: "existing-uid", email: "fixture@test.local", ...args }, log() {} });
test("owner dry run writes nothing", async () => {
  const fake = createFakeFirestore();
  assert.equal((await invoke(fake, {})).written, 0);
  assert.equal(fake.records.size, 0);
});
test("apply grants owner to existing UID without Auth operations", async () => {
  const fake = createFakeFirestore();
  await invoke(fake, { apply: true, displayName: "Fixture owner" });
  const owner = fake.records.get("platformAccounts/existing-uid");
  assert.equal(owner.role, "owner");
  assert.equal(owner.status, "active");
  assert.equal(owner.createdBy, "existing-uid");
  assert.equal(owner.email, "fixture@test.local");
  assert.equal(owner.displayName, "Fixture owner");
  assert.ok(owner.createdAt);
});
test("re-run preserves createdAt and unrelated fields", async () => {
  const fake = createFakeFirestore({ "platformAccounts/existing-uid": { createdAt: "original", extra: "kept" } });
  await invoke(fake, { apply: true });
  assert.equal(fake.records.get("platformAccounts/existing-uid").createdAt, "original");
  assert.equal(fake.records.get("platformAccounts/existing-uid").extra, "kept");
});
test("missing UID fails before any writes", async () => {
  const fake = createFakeFirestore();
  await assert.rejects(() => invoke(fake, { uid: undefined, apply: true }), /--uid/);
  assert.equal(fake.records.size, 0);
});
