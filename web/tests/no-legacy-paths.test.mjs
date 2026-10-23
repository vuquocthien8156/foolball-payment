import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

const DEFERRED = ["pages/Dashboard.tsx", "components/ScoringLayout.tsx"];
const PENDING = [];
const allowed = new Set(["lib/groups.ts", "App.tsx", ...DEFERRED, ...PENDING]);
const hasLegacyPath = (source) => /["'`]\/(admin|public|login)(\/|["'`?])/.test(
  source.replace(/`\/public\/\$\{groupId\}\/(attendance|auto-attendance|notification-token)`/g, "")
);
test("navigation guard distinguishes group public API paths from legacy page URLs", () => {
  assert.equal(hasLegacyPath('postApiJson(`/public/${groupId}/attendance`, {})'), false);
  assert.equal(hasLegacyPath('navigate("/public/pay")'), true);
  assert.equal(hasLegacyPath('postApiJson(`/public/${groupId}/attendance`, {}); navigate("/public/pay")'), true);
});
test("no unplanned legacy navigation paths; PENDING shrinks as pages are fixed", () => {
  const root = new URL("../src/", import.meta.url);
  const matches = fs.readdirSync(root, { recursive: true }).filter((file) => /\.(tsx|ts)$/.test(file) &&
    hasLegacyPath(fs.readFileSync(new URL(file, root), "utf8")));
  for (const file of matches) assert.ok(allowed.has(file.split(path.sep).join("/")), `Unscoped legacy navigation in ${file}`);
  for (const file of PENDING) assert.ok(matches.includes(file), `Remove completed file from PENDING: ${file}`);
});
