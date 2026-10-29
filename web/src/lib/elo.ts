// Elo Rating Engine & Types for Frontend

export const BASE_ELO = 1000;
export const K_FACTOR = 32;

export type EloTier = "master" | "diamond" | "gold" | "silver";

export interface EloHistoryEntry {
  matchId: string;
  date: string;
  result: "WIN" | "LOSS" | "DRAW";
  delta: number;
  newElo: number;
  teamName: string;
  opponentName: string;
  scoreLabel?: string;
}

export interface MemberEloStats {
  memberId: string;
  name: string;
  nickname?: string;
  avatarUrl?: string;
  inactive?: boolean;
  elo: number;
  rank: number;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  recentForm: ("W" | "D" | "L")[];
  tier: EloTier;
  lastDelta?: number;
  history: EloHistoryEntry[];
}

export interface GroupEloSnapshot {
  groupId: string;
  updatedAt: any;
  totalMatchesProcessed: number;
  rankings: MemberEloStats[];
}

/**
 * Determine Elo Tier from Elo rating.
 */
export function getEloTier(elo: number): EloTier {
  if (elo >= 1100) return "master";
  if (elo >= 1050) return "diamond";
  if (elo >= 1000) return "gold";
  return "silver";
}

export interface TierInfo {
  label: string;
  color: string;
  bgBadge: string;
  icon: string;
  gradient: string;
}

export const TIER_CONFIG: Record<EloTier, TierInfo> = {
  master: {
    label: "Huyền thoại",
    color: "text-amber-500 dark:text-amber-400",
    bgBadge: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
    icon: "👑",
    gradient: "from-amber-500 via-yellow-400 to-orange-500",
  },
  diamond: {
    label: "Kim cương",
    color: "text-cyan-500 dark:text-cyan-400",
    bgBadge: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30",
    icon: "💎",
    gradient: "from-cyan-500 via-blue-500 to-indigo-500",
  },
  gold: {
    label: "Vàng",
    color: "text-emerald-500 dark:text-emerald-400",
    bgBadge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
    icon: "🥇",
    gradient: "from-emerald-500 via-teal-500 to-green-500",
  },
  silver: {
    label: "Bạc",
    color: "text-slate-500 dark:text-slate-400",
    bgBadge: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
    icon: "🥈",
    gradient: "from-slate-400 via-zinc-400 to-neutral-500",
  },
};

/**
 * Calculate Elo Delta for two teams.
 */
export function calculateEloDelta(
  avgEloA: number,
  avgEloB: number,
  scoreA: number,
  k = K_FACTOR
): { deltaA: number; deltaB: number; expectedA: number; expectedB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (avgEloB - avgEloA) / 400));
  const expectedB = 1 - expectedA;
  const deltaA = Math.round(k * (scoreA - expectedA));
  const deltaB = Math.round(k * ((1 - scoreA) - expectedB));
  return { deltaA, deltaB, expectedA, expectedB };
}

export interface TeamEloStats {
  totalElo: number;
  avgElo: number;
  count: number;
}

export interface BalancedTeamResult<T> {
  teams: T[][];
  teamStats: TeamEloStats[];
  deltaElo: number;
}

/**
 * Balance members into N teams using snake-draft and 2-opt refinement
 * to ensure equal team sizes and minimal average Elo difference.
 */
export function balanceTeamsByElo<T extends { elo?: number }>(
  members: T[],
  teamCount = 2
): BalancedTeamResult<T> {
  if (teamCount <= 0) return { teams: [], teamStats: [], deltaElo: 0 };
  if (members.length === 0) {
    return {
      teams: Array.from({ length: teamCount }, () => []),
      teamStats: Array.from({ length: teamCount }, () => ({ totalElo: 0, avgElo: 0, count: 0 })),
      deltaElo: 0,
    };
  }

  // 1. Sort descending by Elo (fallback to BASE_ELO = 1000)
  const sorted = [...members].sort((a, b) => (b.elo ?? BASE_ELO) - (a.elo ?? BASE_ELO));

  // 2. Snake draft distribution
  const teams: T[][] = Array.from({ length: teamCount }, () => []);
  sorted.forEach((member, index) => {
    const round = Math.floor(index / teamCount);
    const posInRound = index % teamCount;
    const teamIndex = round % 2 === 0 ? posInRound : teamCount - 1 - posInRound;
    teams[teamIndex].push(member);
  });

  // 3. 2-Opt local search refinement: pairwise swap to minimize average difference
  const getTeamAvg = (team: T[]) =>
    team.length === 0
      ? 0
      : team.reduce((sum, m) => sum + (m.elo ?? BASE_ELO), 0) / team.length;

  let improved = true;
  let iterations = 0;
  const maxIterations = 50;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < teamCount; i++) {
      for (let j = i + 1; j < teamCount; j++) {
        const avgI = getTeamAvg(teams[i]);
        const avgJ = getTeamAvg(teams[j]);
        const currentDiff = Math.abs(avgI - avgJ);

        let bestSwap: [number, number] | null = null;
        let bestDiff = currentDiff;

        for (let mI = 0; mI < teams[i].length; mI++) {
          for (let mJ = 0; mJ < teams[j].length; mJ++) {
            const eloI = teams[i][mI].elo ?? BASE_ELO;
            const eloJ = teams[j][mJ].elo ?? BASE_ELO;

            const sumI = teams[i].reduce((s, m) => s + (m.elo ?? BASE_ELO), 0) - eloI + eloJ;
            const sumJ = teams[j].reduce((s, m) => s + (m.elo ?? BASE_ELO), 0) - eloJ + eloI;
            const newAvgI = sumI / teams[i].length;
            const newAvgJ = sumJ / teams[j].length;
            const newDiff = Math.abs(newAvgI - newAvgJ);

            if (newDiff < bestDiff - 0.5) {
              bestDiff = newDiff;
              bestSwap = [mI, mJ];
            }
          }
        }

        if (bestSwap) {
          const [mI, mJ] = bestSwap;
          const temp = teams[i][mI];
          teams[i][mI] = teams[j][mJ];
          teams[j][mJ] = temp;
          improved = true;
        }
      }
    }
  }

  // 4. Calculate final stats
  const teamStats = teams.map((team) => {
    const total = team.reduce((s, m) => s + (m.elo ?? BASE_ELO), 0);
    return {
      totalElo: total,
      avgElo: team.length === 0 ? 0 : Math.round(total / team.length),
      count: team.length,
    };
  });

  const avgs = teamStats.map((s) => s.avgElo);
  const deltaElo = avgs.length > 0 ? Math.max(...avgs) - Math.min(...avgs) : 0;

  return { teams, teamStats, deltaElo };
}


