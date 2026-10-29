// Elo Rating Engine for Football Group

const BASE_ELO = 1000;
const K_FACTOR = 32;

/**
 * Calculate Elo Delta for two teams based on average Elo ratings.
 * @param {number} avgEloA - Average Elo of Team A
 * @param {number} avgEloB - Average Elo of Team B
 * @param {number} scoreA - 1 for Team A win, 0.5 for Draw, 0 for Team B win
 * @param {number} k - K factor (default 32)
 */
function calculateEloDelta(avgEloA, avgEloB, scoreA, k = K_FACTOR) {
  const expectedA = 1 / (1 + Math.pow(10, (avgEloB - avgEloA) / 400));
  const expectedB = 1 - expectedA;
  const deltaA = Math.round(k * (scoreA - expectedA));
  const deltaB = Math.round(k * ((1 - scoreA) - expectedB));
  return { deltaA, deltaB, expectedA, expectedB };
}

/**
 * Determine Elo Tier from Elo rating.
 * @param {number} elo
 * @returns {'master' | 'diamond' | 'gold' | 'silver'}
 */
function getEloTier(elo) {
  if (elo >= 1100) return "master";
  if (elo >= 1050) return "diamond";
  if (elo >= 1000) return "gold";
  return "silver";
}

/**
 * Compute group Elo ratings from chronological match history.
 * @param {Array} members - List of member objects { id, name, nickname, inactive }
 * @param {Array} matches - Chronological list of matches { id, date, teamsConfig, status, isDeleted, ... }
 * @param {Function} [getShares] - Optional async function to fetch shares for a match if team.members is empty: async (matchId) => [{ memberId, teamId, amount }]
 * @returns {Promise<{ rankings: Array, allStats: Map<string, object>, totalMatches: number }>}
 */
async function computeGroupElo(members, matches, getShares) {
  // Sort matches chronologically ascending
  const sortedMatches = [...matches].sort((a, b) => {
    const da = a.date?._seconds || (a.date ? new Date(a.date).getTime() / 1000 : 0);
    const db = b.date?._seconds || (b.date ? new Date(b.date).getTime() / 1000 : 0);
    return da - db;
  });

  // Initialize stats for all members
  const memberMap = new Map();
  const playerStats = new Map();

  for (const m of members) {
    memberMap.set(m.id, m);
    playerStats.set(m.id, {
      memberId: m.id,
      name: m.name || "Cầu thủ",
      nickname: m.nickname || "",
      inactive: !!m.inactive,
      elo: BASE_ELO,
      rank: 0,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
      recentForm: [],
      lastDelta: 0,
      history: []
    });
  }

  let processedMatches = 0;

  for (const m of sortedMatches) {
    if (m.isDeleted) continue;
    if (m.status && m.status !== "PUBLISHED") continue;

    const teams = m.teamsConfig || [];
    if (teams.length < 2) continue;

    let t0Members = (teams[0].members || []).map(x => (typeof x === "string" ? x : x?.id)).filter(Boolean);
    let t1Members = (teams[1].members || []).map(x => (typeof x === "string" ? x : x?.id)).filter(Boolean);

    // If config does not have member IDs, fallback to shares if loader provided
    if ((t0Members.length === 0 || t1Members.length === 0) && typeof getShares === "function") {
      const shares = await getShares(m.id, m);
      t0Members = [];
      t1Members = [];
      for (const s of shares) {
        if (s.teamId === teams[0].id) t0Members.push(s.memberId);
        else if (s.teamId === teams[1].id) t1Members.push(s.memberId);
      }
    }

    if (t0Members.length === 0 || t1Members.length === 0) continue;

    // Filter unique member IDs
    t0Members = Array.from(new Set(t0Members));
    t1Members = Array.from(new Set(t1Members));

    // Determine match outcome:
    // In football splitting: the team paying lower percent is the winner.
    // If equal percents, outcome is a draw.
    const p0 = teams[0].percent ?? 50;
    const p1 = teams[1].percent ?? 50;
    let score0 = 0.5;
    if (p0 < p1) score0 = 1; // Team 0 won
    else if (p0 > p1) score0 = 0; // Team 1 won

    // Calculate team average Elos
    const avg0 = t0Members.reduce((sum, id) => {
      const p = playerStats.get(id);
      return sum + (p ? p.elo : BASE_ELO);
    }, 0) / t0Members.length;

    const avg1 = t1Members.reduce((sum, id) => {
      const p = playerStats.get(id);
      return sum + (p ? p.elo : BASE_ELO);
    }, 0) / t1Members.length;

    const { deltaA, deltaB } = calculateEloDelta(avg0, avg1, score0);

    const matchDateStr = m.date?._seconds
      ? new Date(m.date._seconds * 1000).toISOString().slice(0, 10)
      : (m.date ? new Date(m.date).toISOString().slice(0, 10) : "");

    const team0Name = teams[0].name || teams[0].id || "Đội 1";
    const team1Name = teams[1].name || teams[1].id || "Đội 2";

    // Update Team 0 members
    for (const id of t0Members) {
      let stat = playerStats.get(id);
      if (!stat) {
        const mem = memberMap.get(id);
        stat = {
          memberId: id,
          name: mem?.name || "Cầu thủ",
          nickname: mem?.nickname || "",
          inactive: !!mem?.inactive,
          elo: BASE_ELO,
          rank: 0,
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          winRate: 0,
          recentForm: [],
          lastDelta: 0,
          history: []
        };
        playerStats.set(id, stat);
      }
      stat.matchesPlayed += 1;
      const res = score0 === 1 ? "WIN" : score0 === 0.5 ? "DRAW" : "LOSS";
      if (res === "WIN") stat.wins += 1;
      else if (res === "DRAW") stat.draws += 1;
      else stat.losses += 1;

      stat.elo += deltaA;
      stat.lastDelta = deltaA;
      stat.recentForm.push(res === "WIN" ? "W" : res === "DRAW" ? "D" : "L");
      if (stat.recentForm.length > 5) stat.recentForm.shift();

      stat.history.push({
        matchId: m.id,
        date: matchDateStr,
        result: res,
        delta: deltaA,
        newElo: stat.elo,
        teamName: team0Name,
        opponentName: team1Name,
        scoreLabel: `${p0}% - ${p1}%`
      });
    }

    // Update Team 1 members
    for (const id of t1Members) {
      let stat = playerStats.get(id);
      if (!stat) {
        const mem = memberMap.get(id);
        stat = {
          memberId: id,
          name: mem?.name || "Cầu thủ",
          nickname: mem?.nickname || "",
          inactive: !!mem?.inactive,
          elo: BASE_ELO,
          rank: 0,
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          winRate: 0,
          recentForm: [],
          lastDelta: 0,
          history: []
        };
        playerStats.set(id, stat);
      }
      stat.matchesPlayed += 1;
      const res = score0 === 0 ? "WIN" : score0 === 0.5 ? "DRAW" : "LOSS";
      if (res === "WIN") stat.wins += 1;
      else if (res === "DRAW") stat.draws += 1;
      else stat.losses += 1;

      stat.elo += deltaB;
      stat.lastDelta = deltaB;
      stat.recentForm.push(res === "WIN" ? "W" : res === "DRAW" ? "D" : "L");
      if (stat.recentForm.length > 5) stat.recentForm.shift();

      stat.history.push({
        matchId: m.id,
        date: matchDateStr,
        result: res,
        delta: deltaB,
        newElo: stat.elo,
        teamName: team1Name,
        opponentName: team0Name,
        scoreLabel: `${p1}% - ${p0}%`
      });
    }

    processedMatches++;
  }

  // Calculate final winRates, tiers, and rank
  for (const stat of playerStats.values()) {
    stat.winRate = stat.matchesPlayed > 0
      ? Number(((stat.wins / stat.matchesPlayed) * 100).toFixed(1))
      : 0;
    stat.tier = getEloTier(stat.elo);
  }

  // Filter only active members for the active leaderboard
  const activeList = Array.from(playerStats.values())
    .filter(p => !p.inactive)
    .sort((a, b) => {
      if (b.elo !== a.elo) return b.elo - a.elo;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
      return a.name.localeCompare(b.name);
    });

  activeList.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    rankings: activeList,
    allStats: playerStats,
    totalMatches: processedMatches
  };
}

module.exports = {
  BASE_ELO,
  K_FACTOR,
  calculateEloDelta,
  getEloTier,
  computeGroupElo
};

