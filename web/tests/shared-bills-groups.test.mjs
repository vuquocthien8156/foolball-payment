import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadSource } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const server = require("../../server/lib/groups.js");
const web = loadSource("../src/lib/groups.ts").exports;
const features = loadSource("../src/lib/features.ts", { "@/lib/groups": web }).exports;

test("both runtimes preserve legacy sports and identify shared bills without a sport", () => {
  for (const helpers of [server, web]) {
    assert.equal(helpers.groupKindOf(), "sports");
    assert.equal(helpers.groupKindOf({ sport: "other" }), "sports");
    assert.equal(helpers.groupKindOf({ kind: "shared_bills" }), "shared_bills");
    assert.equal(helpers.isValidGroupKind("subscription"), false);
    assert.equal(helpers.isValidGroupKind("shared_bills"), true);
  }
});

test("shared bill groups never inherit football-only features", () => {
  for (const key of Object.keys(features.FEATURES)) {
    assert.equal(features.hasFeature("football-zigvy", { kind: "shared_bills", sport: "football" }, key), false);
  }
});
