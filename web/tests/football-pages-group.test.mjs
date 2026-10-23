import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const liveStats = loadSource("../src/lib/liveStats.ts").exports;
const utils = loadSource("../src/lib/utils.ts").exports;
const gid = "football-zigvy";
function setup(page, state = {}) {
  const fake = createFakeFirestore({
    "members/a": { groupId: gid, name: "Football player" },
    "members/b": { groupId: "badm-1", name: "Other player" },
    "matches/m1": { groupId: gid, status: "PUBLISHED", date: Timestamp.fromMillis(1792497600000), teamsConfig: [], ratingsPublished: true },
    "matches/other": { groupId: "badm-1", status: "PUBLISHED", date: Timestamp.fromMillis(1792497601000), teamsConfig: [{ id: "secret-team", name: "Other group", members: [] }], ratingsPublished: true },
  });
  const navigations = [];
  const actions = { weights: liveStats.defaultActionWeights, labelMap: {}, okActions: [], badActions: [], loading: false };
  const host = mountPage(page, state, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid }), useGroupPath: () => (sub) => groups.groupPath(gid, sub) },
    "@/lib/groups": groups, "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore,
    "@/lib/utils": utils, "@/lib/liveStats": liveStats, "@/hooks/useActionConfigs": { useActionConfigs: () => actions },
    "@/contexts/AuthContext": { useAuth: () => ({ user: { uid: "fake" } }) },
    "@/hooks/useGroupRole": { useGroupRole: () => ({ role: "manager", isManager: true, loading: false }) },
    "@/hooks/use-toast": { toast() {} },
    "react-router-dom": { useNavigate: () => (path) => navigations.push(path), useSearchParams: () => [new URLSearchParams()] },
    "@/lib/api": { postApiJson: async () => ({}) },
  }, { URLSearchParams });
  return { ...fake, host, navigations };
}
for (const page of ["ScoringMatches", "LiveNotes", "PublicRatings"]) test(`${page}: members and matches queries have groupId; no collectionGroup query`, async () => {
  const { host, log } = setup(page);
  await host.flush({ runEffects: true });
  const queries = log.filter((entry) => entry.constraints && ["members", "matches"].includes(entry.path));
  assert.ok(queries.some((entry) => entry.path === "members"));
  assert.ok(queries.some((entry) => entry.path === "matches"));
  if (page === "PublicRatings") assert.ok(queries.filter((entry) => entry.path === "matches").length >= 2);
  for (const query of queries) assert.ok(query.constraints.some((c) => c.field === "groupId" && c.op === "==" && c.value === gid), JSON.stringify(query));
  assert.equal(log.some((entry) => entry.group), false);
  assert.equal(host.states.get("matches").some((match) => match.id === "other"), false);
});
for (const page of ["LiveNotes", "PublicRatings"]) test(`${page}: other-group match id → not found`, async () => {
  const { host } = setup(page, { selectedMatchId: "other", members: new Map([["a", "Football player"]]) });
  await host.flush({ runEffects: true });
  assert.notEqual(host.states.get("selectedMatchId"), "other");
  assert.equal((host.states.get("teamsConfig") || []).some((team) => team.id === "secret-team"), false);
});
test("scoring still writes configs/scoringWeights", async () => {
  const { host, log } = setup("ScoringMatches");
  await host.page.handleSaveWeights();
  assert.equal(log.find((entry) => entry.op === "set").path, "configs/scoringWeights");
});
test("team-locked link goes to group attendance", () => {
  const { host, navigations } = setup("TeamLocked", { status: "success" });
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === "Button" && node.props.onClick) node.props.onClick();
    visit(node.props?.children);
  };
  visit(host.render());
  assert.ok(navigations.length > 0);
  assert.ok(navigations.every((path) => path === "/g/football-zigvy/public/attendance"));
});

test("Scoring manager without userRoles keeps peer-score controls", () => {
  const { host } = setup("ScoringMatches");
  assert.equal(host.page.canSeePeerScores, true);
  assert.equal(host.page.shouldHidePeerScores, false);
});
