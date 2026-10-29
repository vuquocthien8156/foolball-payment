import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "./helpers.mjs";

const eloLib = loadSource("../src/lib/elo.ts").exports;

test("calculateEloDelta calculates correct win, loss, and draw deltas", () => {
  // Evenly matched teams (1000 vs 1000)
  const draw = eloLib.calculateEloDelta(1000, 1000, 0.5);
  assert.equal(draw.expectedA, 0.5);
  assert.equal(draw.expectedB, 0.5);
  assert.equal(draw.deltaA, 0);
  assert.equal(draw.deltaB, 0);

  // Team A wins against equal team
  const win = eloLib.calculateEloDelta(1000, 1000, 1.0);
  assert.equal(win.deltaA, 16);
  assert.equal(win.deltaB, -16);

  // Underdog wins (Team A 900 vs Team B 1100)
  const underdogWin = eloLib.calculateEloDelta(900, 1100, 1.0);
  assert.ok(underdogWin.deltaA > 16, `Underdog should gain more than 16: ${underdogWin.deltaA}`);
  assert.ok(underdogWin.deltaB < -16, `Favorite should lose more than 16: ${underdogWin.deltaB}`);
});

test("getEloTier classifies tiers correctly", () => {
  assert.equal(eloLib.getEloTier(1200), "master");
  assert.equal(eloLib.getEloTier(1100), "master");
  assert.equal(eloLib.getEloTier(1075), "diamond");
  assert.equal(eloLib.getEloTier(1050), "diamond");
  assert.equal(eloLib.getEloTier(1020), "gold");
  assert.equal(eloLib.getEloTier(1000), "gold");
  assert.equal(eloLib.getEloTier(950), "silver");
  assert.equal(eloLib.getEloTier(800), "silver");
});

test("balanceTeamsByElo balances 2 teams with equal headcounts and minimal Elo difference", () => {
  const members = [
    { id: "p1", name: "Player 1", elo: 1200 },
    { id: "p2", name: "Player 2", elo: 1150 },
    { id: "p3", name: "Player 3", elo: 1100 },
    { id: "p4", name: "Player 4", elo: 1050 },
    { id: "p5", name: "Player 5", elo: 1020 },
    { id: "p6", name: "Player 6", elo: 1000 },
    { id: "p7", name: "Player 7", elo: 980 },
    { id: "p8", name: "Player 8", elo: 950 },
    { id: "p9", name: "Player 9", elo: 920 },
    { id: "p10", name: "Player 10", elo: 890 },
  ];

  const result = eloLib.balanceTeamsByElo(members, 2);
  assert.equal(result.teams.length, 2);
  assert.equal(result.teams[0].length, 5);
  assert.equal(result.teams[1].length, 5);

  // Both teams should have very close average Elo
  const avg0 = result.teamStats[0].avgElo;
  const avg1 = result.teamStats[1].avgElo;
  assert.ok(Math.abs(avg0 - avg1) <= 15, `Difference should be <= 15, got ${Math.abs(avg0 - avg1)}`);
});

test("balanceTeamsByElo handles odd number of players", () => {
  const members = [
    { id: "p1", name: "Player 1", elo: 1150 },
    { id: "p2", name: "Player 2", elo: 1080 },
    { id: "p3", name: "Player 3", elo: 1050 },
    { id: "p4", name: "Player 4", elo: 1000 },
    { id: "p5", name: "Player 5", elo: 960 },
  ];

  const result = eloLib.balanceTeamsByElo(members, 2);
  assert.equal(result.teams.length, 2);
  assert.equal(result.teams[0].length + result.teams[1].length, 5);
  assert.ok(Math.abs(result.teams[0].length - result.teams[1].length) <= 1);
});

test("balanceTeamsByElo handles empty members or 0 teams gracefully", () => {
  const empty = eloLib.balanceTeamsByElo([], 2);
  assert.equal(empty.teams.length, 2);
  assert.equal(empty.teams[0].length, 0);
  assert.equal(empty.teams[1].length, 0);

  const zeroTeams = eloLib.balanceTeamsByElo([{ id: "p1", elo: 1000 }], 0);
  assert.equal(zeroTeams.teams.length, 0);
});
