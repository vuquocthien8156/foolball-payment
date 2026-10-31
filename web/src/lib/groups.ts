export const DEFAULT_GROUP_ID = "football-zigvy";
export const DEFAULT_GROUP_NAME = "Football Zigvy Group";
export const GROUP_KINDS = ["sports", "shared_bills"] as const;
export type GroupKind = typeof GROUP_KINDS[number];
export const isValidGroupKind = (kind: unknown): kind is GroupKind => GROUP_KINDS.includes(kind as GroupKind);
export const groupKindOf = (group?: { kind?: string } | null): GroupKind => group?.kind === "shared_bills" ? "shared_bills" : "sports";
export const GROUP_SPORTS = ["football", "badminton", "pickleball", "other"] as const;
export type GroupSport = typeof GROUP_SPORTS[number];
export const SPORT_LABELS: Record<GroupSport, string> = {
  football: "Bóng đá", badminton: "Cầu lông", pickleball: "Pickleball", other: "Khác",
};

export const SPORT_ICONS: Record<GroupSport, string> = {
  football: "⚽",
  badminton: "🏸",
  pickleball: "🏓",
  other: "🏆",
};

export const GROUP_KIND_ICONS: Record<GroupKind, string> = {
  sports: "🏆",
  shared_bills: "🧾",
};

export function getSportEmoji(sport?: string | null): string {
  if (!sport) return "🏆";
  return (SPORT_ICONS as Record<string, string>)[sport] || "🏆";
}

export function getGroupEmoji(group?: { id?: string; sport?: string; kind?: string } | null): string {
  if (!group) return "🏆";
  if (group.kind === "shared_bills") return GROUP_KIND_ICONS.shared_bills;
  if (group.sport && (SPORT_ICONS as Record<string, string>)[group.sport]) {
    return (SPORT_ICONS as Record<string, string>)[group.sport];
  }
  if (group.id === DEFAULT_GROUP_ID) return SPORT_ICONS.football;
  return "🏆";
}

export function getMatchNoun(sport?: string | null): { single: string; capitalized: string; venue: string } {
  if (sport === "badminton") {
    return { single: "buổi cầu", capitalized: "Buổi cầu", venue: "sân cầu lông" };
  }
  if (sport === "pickleball") {
    return { single: "buổi pickleball", capitalized: "Buổi pickleball", venue: "sân pickleball" };
  }
  return { single: "trận", capitalized: "Trận", venue: "sân bóng" };
}

export function groupSportOf(group?: { sport?: string } | null): GroupSport {
  return GROUP_SPORTS.includes(group?.sport as GroupSport) ? group.sport as GroupSport : "other";
}
export const isValidGroupId = (id: string): boolean => typeof id === "string" && /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(id);
export const groupIdOf = (data?: { groupId?: string } | null): string => data?.groupId || DEFAULT_GROUP_ID;
export const groupPath = (gid: string, sub = ""): string => `/g/${gid}${sub ? `/${sub.replace(/^\//, "")}` : ""}`;
export function resolveLegacyRedirect(pathname: string, search: string): string | null {
  return /^\/(public|admin)(\/|$)/.test(pathname) || pathname === "/login"
    ? groupPath(DEFAULT_GROUP_ID, pathname) + search : null;
}
export const scopedKey = (base: string, gid: string): string => `${base}:${gid}`;
export const settingsDocPath = (gid: string, name: string): [string, string, string, string] => ["groups", gid, "settings", name];
