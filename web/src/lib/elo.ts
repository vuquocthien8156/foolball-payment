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

