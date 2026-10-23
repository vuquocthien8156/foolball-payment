import { DEFAULT_GROUP_ID, GroupSport, groupSportOf, groupKindOf } from "@/lib/groups";

export type FeatureKey = "teamPropose" | "scoring" | "liveNotes" | "ratings";
export type FeatureDef = { sports: readonly GroupSport[]; enabled: boolean; onlyGroups?: readonly string[] };
export const FEATURES: Record<FeatureKey, FeatureDef> = {
  teamPropose: { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] },
  scoring: { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] },
  liveNotes: { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] },
  ratings: { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] },
};
export function hasFeature(groupId: string, group: { sport?: string; kind?: string } | null | undefined, key: FeatureKey,
  registry: Record<FeatureKey, FeatureDef> = FEATURES): boolean {
  const feature = registry[key];
  if (groupKindOf(group) !== "sports") return false;
  if (!feature.enabled || !feature.sports.includes(groupSportOf(group))) return false;
  return !feature.onlyGroups || feature.onlyGroups.includes(groupId);
}
