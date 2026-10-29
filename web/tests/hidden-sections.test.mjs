import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";
import { createFakeFirestore, Timestamp } from "./fake-firestore.mjs";
const groups = loadSource("../src/lib/groups.ts").exports;
const features = loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports;
const utils = loadSource("../src/lib/utils.ts").exports;
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
function setup(page, gid) {
  const fake = createFakeFirestore({ "appConfig/publicPasscode": { passcode: "fake" } });
  const reads = [];
  const original = fake.firestore.getDoc;
  fake.firestore.getDoc = (ref) => { reads.push(ref.path); return original(ref); };
  const match = { id: "m1", date: Timestamp.fromMillis(1792497600000), status: "COMPLETED", teamsConfig: [], totalAmount: 0 };
  const toast = () => {};
  const groupPath = (sub) => groups.groupPath(gid, sub);
  const host = mountPage(page, {
    isLoading: false, match, matchId: "m1", isLoadingMatches: false, matches: [match], selectedMatchId: "m1",
  }, {
    "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid, group: { sport: gid === "football-zigvy" ? "football" : "badminton" } }), useGroupPath: () => groupPath },
    "@/lib/features": features, "@/lib/groups": groups, "@/lib/firebase": { db: fake.db },
    "firebase/firestore": fake.firestore,
    "react-router-dom": { useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(), () => {}], Link: "Link" },
    "@/lib/utils": utils, "@/lib/liveStats": { aggregateLiveStats: () => new Map() },
    "@/hooks/useActionConfigs": { useActionConfigs: () => ({ actions: [], weights: {} }) },
    "react-dom": { createPortal: (child) => child },
    "@/lib/api": { postApiJson: async () => ({}), apiRequest: async () => ({ botConfigured: false }) }, "@/lib/notifications": { ensureNotificationToken: async () => null },
    "@/contexts/AuthContext": { useAuth: () => ({ user: { uid: "fake" } }) },
    "@/components/ui/use-toast": { useToast: () => ({ toast }) }, "@/hooks/use-toast": { toast },
    "@/hooks/useLocalStorage": { default: () => [[], () => {}] }, html2canvas: { default() {} },
  }, { navigator: { userAgent: "fake" }, localStorage: { getItem: () => null }, window: { location: { origin: "http://localhost" } }, URLSearchParams });
  return { host, reads };
}
for (const [page, section, core] of [
  ["Attendance", "Chia đội kéo thả", "Không tìm thấy thành viên"],
  ["PublicPortal", "Bảng xếp hạng ELO", "Thanh toán"],
  ["Matches", "Công khai đánh giá", "Danh sách trận đấu"],
  ["Config", "Passcode gửi đội hình", "Cấu hình hệ thống"],
]) test(`${page}: Football section shown for Zigvy, hidden for badminton; core content still renders`, () => {
  for (const gid of ["football-zigvy", "badm-1"]) {
    const { host } = setup(page, gid);
    const output = text(host.render());
    assert.equal(output.includes(section), gid === "football-zigvy", `${page}: ${gid}`);
    assert.ok(output.includes(core), `${page}: core ${gid}`);
  }
});
test("Config reads appConfig for Zigvy and skips it for badminton without endless loading", async () => {
  for (const gid of ["football-zigvy", "badm-1"]) {
    const { host, reads } = setup("Config", gid);
    await host.flush({ runEffects: true });
    assert.deepEqual(reads, gid === "football-zigvy" ? ["appConfig/publicPasscode"] : []);
    assert.equal(host.states.get("isLoading"), false);
    if (gid === "badm-1") assert.ok(text(host.render()).includes("Thông báo Slack"));
  }
});
