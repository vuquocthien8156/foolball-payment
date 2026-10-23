export const DEFAULT_GROUP_ID = "football-zigvy";
export const DEFAULT_GROUP_NAME = "Football Zigvy Group";
export const GROUP_SPORTS = ["football", "badminton", "pickleball", "other"] as const;
export type GroupSport = typeof GROUP_SPORTS[number];
export const SPORT_LABELS: Record<GroupSport, string> = {
  football: "Bóng đá", badminton: "Cầu lông", pickleball: "Pickleball", other: "Khác",
};

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
