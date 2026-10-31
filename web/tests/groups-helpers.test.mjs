import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { loadSource } from "./helpers.mjs";
const require = createRequire(import.meta.url);
const web = loadSource("../src/lib/groups.ts").exports;
const server = require("../../server/lib/groups.js");

test("DEFAULT_GROUP_ID equal in web and server", () => assert.equal(web.DEFAULT_GROUP_ID, server.DEFAULT_GROUP_ID));
test("GROUP_SPORTS equal in web and server", () => assert.deepEqual(Array.from(web.GROUP_SPORTS), server.GROUP_SPORTS));
test("groupSportOf unknown/missing → other", () => {
  for (const group of [null, undefined, {}, { sport: "tennis" }]) assert.equal(web.groupSportOf(group), "other");
  assert.equal(web.groupSportOf({ sport: "football" }), "football");
});
test("isValidSport rejects tennis", () => {
  assert.equal(server.isValidSport("tennis"), false);
  for (const sport of server.GROUP_SPORTS) assert.equal(server.isValidSport(sport), true);
});
test("groupIdOf falls back to default", () => {
  for (const helper of [web.groupIdOf, server.groupIdOf]) {
    for (const data of [undefined, null, {}, { groupId: "" }]) assert.equal(helper(data), "football-zigvy");
    assert.equal(helper({ groupId: "badm-1" }), "badm-1");
  }
});
test("isValidGroupId accepts/rejects boundary values", () => {
  for (const helper of [web.isValidGroupId, server.isValidGroupId]) {
    for (const value of ["abc", "badm-1", "football-zigvy", "a".repeat(40)]) assert.equal(helper(value), true, value);
    for (const value of ["", "a", "ab", "-xx", "xx-", "ABC", "a".repeat(41), "a/b", null]) assert.equal(helper(value), false, String(value));
  }
});
test("resolveLegacyRedirect keeps query and ignores unrelated paths", () => {
  for (const path of ["/public", "/public/attendance", "/admin", "/admin/setup/m1", "/login"]) {
    assert.equal(web.resolveLegacyRedirect(path, "?matchId=m&token=test"), `/g/football-zigvy${path}?matchId=m&token=test`);
  }
  for (const path of ["/g/badm-1/public", "/platform", "/publicity", "/administrator", "/login/other"]) assert.equal(web.resolveLegacyRedirect(path, ""), null);
});
test("makeGroupId Vietnamese and generated IDs are valid", () => {
  assert.equal(server.makeGroupId("Cầu Lông Đà Nẵng", "xxxx"), "cau-long-da-nang-xxxx");
  assert.equal(server.makeGroupId("---", "1234"), "group-1234");
  assert.ok(server.isValidGroupId(server.makeGroupId("a".repeat(29) + " name", "xxxx")));
});
test("publicUrlFor default unchanged / other group path", () => {
  assert.equal(server.publicUrlFor("football-zigvy", "https://example.test/public/"), "https://example.test/public/");
  assert.equal(server.publicUrlFor("badm-1", "https://example.test/public"), "https://example.test/g/badm-1/public");
});
test("group paths, scoped storage, settings path and mismatching item", () => {
  assert.equal(web.groupPath("badm-1"), "/g/badm-1");
  assert.equal(web.groupPath("badm-1", "/public/pay"), "/g/badm-1/public/pay");
  assert.equal(web.scopedKey("lastMember", "badm-1"), "lastMember:badm-1");
  assert.deepEqual(Array.from(web.settingsDocPath("badm-1", "lastMatch")), ["groups", "badm-1", "settings", "lastMatch"]);
  const other = { groupId: "badm-1" };
  assert.equal(server.assertSameGroup("football-zigvy", [{}, other]), other);
  assert.equal(server.assertSameGroup("football-zigvy", [{}, { groupId: "football-zigvy" }]), null);
});

test("SPORT_ICONS and GROUP_KIND_ICONS equal in web and server", () => {
  assert.deepEqual({ ...web.SPORT_ICONS }, { ...server.SPORT_ICONS });
  assert.deepEqual({ ...web.GROUP_KIND_ICONS }, { ...server.GROUP_KIND_ICONS });
});

test("getSportEmoji returns expected icons with fallback", () => {
  for (const helper of [web.getSportEmoji, server.getSportEmoji]) {
    assert.equal(helper("football"), "⚽");
    assert.equal(helper("badminton"), "🏸");
    assert.equal(helper("pickleball"), "🏓");
    assert.equal(helper("other"), "🏆");
    assert.equal(helper(null), "🏆");
    assert.equal(helper("unknown"), "🏆");
  }
});

test("getGroupEmoji resolves group kinds and sports", () => {
  for (const helper of [web.getGroupEmoji, server.getGroupEmoji]) {
    assert.equal(helper(null), "🏆");
    assert.equal(helper({ kind: "shared_bills" }), "🧾");
    assert.equal(helper({ sport: "badminton" }), "🏸");
    assert.equal(helper({ sport: "football" }), "⚽");
    assert.equal(helper({ sport: "pickleball" }), "🏓");
    assert.equal(helper({ id: "football-zigvy" }), "⚽");
    assert.equal(helper({}), "🏆");
  }
});

test("getMatchNoun returns sport-appropriate terminology", () => {
  for (const helper of [web.getMatchNoun, server.getMatchNoun]) {
    assert.deepEqual({ ...helper("badminton") }, { single: "buổi cầu", capitalized: "Buổi cầu", venue: "sân cầu lông" });
    assert.deepEqual({ ...helper("pickleball") }, { single: "buổi pickleball", capitalized: "Buổi pickleball", venue: "sân pickleball" });
    assert.deepEqual({ ...helper("football") }, { single: "trận", capitalized: "Trận", venue: "sân bóng" });
    assert.deepEqual({ ...helper("other") }, { single: "trận", capitalized: "Trận", venue: "sân bóng" });
  }
});
