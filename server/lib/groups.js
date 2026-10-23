const DEFAULT_GROUP_ID = "football-zigvy";
const GROUP_KINDS = ["sports", "shared_bills"];
const isValidGroupKind = (kind) => GROUP_KINDS.includes(kind);
const groupKindOf = (group) => group?.kind === "shared_bills" ? "shared_bills" : "sports";
const GROUP_SPORTS = ["football", "badminton", "pickleball", "other"];
const isValidSport = (sport) => GROUP_SPORTS.includes(sport);
const groupIdOf = (data) => data?.groupId || DEFAULT_GROUP_ID;
const isValidGroupId = (id) => typeof id === "string" && /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(id);
function makeGroupId(name, randomSuffix) {
  const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "group";
  return `${slug}-${randomSuffix}`;
}
const publicUrlFor = (gid, basePublicUrl) => gid === DEFAULT_GROUP_ID ? basePublicUrl : `${new URL(basePublicUrl).origin}/g/${gid}/public`;
const assertSameGroup = (expected, items) => items.find((item) => groupIdOf(item) !== expected) ?? null;
module.exports = { DEFAULT_GROUP_ID, GROUP_KINDS, isValidGroupKind, groupKindOf, GROUP_SPORTS, isValidSport, groupIdOf, isValidGroupId, makeGroupId, publicUrlFor, assertSameGroup };
