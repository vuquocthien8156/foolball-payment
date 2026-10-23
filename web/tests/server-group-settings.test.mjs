import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCjs } from "./load-cjs.mjs";
import { startRouter } from "./http-harness.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { loadSource, mountPage } from "./helpers.mjs";
function slackHost({ muted = false, token = "fake-bot-token", error } = {}) {
  const calls = [];
  const slack = loadCjs("../../server/lib/slack.js", {
    axios: { post: async (...args) => { calls.push(args); return { data: error ? { ok: false, error } : { ok: true } }; } },
    "./slackConfig": { TIMEZONE: "Asia/Ho_Chi_Minh" }, "./mute": { isMuted: () => muted },
  }, { process: { env: { SLACK_BOT_TOKEN: token, SLACK_WEBHOOK_URL: "https://webhook.test.invalid" } }, console: { log() {}, warn() {}, error() {} } });
  return { slack, calls };
}
async function settingsHost(t, options = {}) {
  const fake = createFakeFirestore({
    "groups/alpha": { name: "Alpha" }, "groupMembers/alpha_manager": { role: "manager" },
    "groupMembers/alpha_admin": { role: "admin", tabs: ["members"] },
    "groups/alpha/settings/slack": { enabled: true, channelId: "C0123ABCD" },
  });
  const { slack, calls } = slackHost(options);
  const { createGroupRouter } = loadCjs("../../server/lib/groupRoutes.js", { "./auth": loadCjs("../../server/lib/auth.js"), "./groups": loadCjs("../../server/lib/groups.js") });
  const host = await startRouter(createGroupRouter({ db: fake.db, auth: createFakeAuth().auth, FieldValue: fake.FieldValue, slack, env: { SLACK_BOT_TOKEN: options.token === "" ? "" : "fake-bot-token" } })); t.after(host.close);
  return { ...fake, calls, async request(method, body, uid = "manager", suffix = "") {
    const res = await fetch(host.url + "/alpha/settings" + suffix, { method, headers: { Authorization: `Bearer uid:${uid}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json() };
  } };
}
test("settings authorize managers, validate/normalize channel, ignore secrets and never send on save", async (t) => {
  const host = await settingsHost(t);
  assert.equal((await host.request("GET", null, "admin")).status, 403);
  const read = await host.request("GET");
  assert.equal(read.data.botConfigured, true);
  assert.ok(!JSON.stringify(read.data).includes("fake-bot-token"));
  const invalid = await host.request("PUT", { channelId: "#name" });
  assert.equal(invalid.status, 400); assert.equal(invalid.data.error, "INVALID_CHANNEL");
  assert.equal((await host.request("PUT", { channelId: " c0123abcd ", channelLabel: "Court", publicPasscode: "ignored" })).status, 200);
  const data = host.records.get("groups/alpha/settings/slack");
  assert.equal(data.channelId, "C0123ABCD"); assert.equal(data.publicPasscode, undefined);
  assert.equal((await host.request("PUT", { channelId: "" })).status, 200);
  assert.equal(host.records.get("groups/alpha/settings/slack").enabled, false);
  assert.equal(host.calls.length, 0);
});
test("Slack test maps errors and emulator mode performs no axios request", async (t) => {
  for (const [options, status, code] of [[{ token: "" }, 503, "SLACK_NOT_CONFIGURED"], [{ error: "not_in_channel" }, 400, "SLACK_NOT_IN_CHANNEL"], [{ error: "channel_not_found" }, 400, "SLACK_CHANNEL_NOT_FOUND"], [{ error: "ratelimited" }, 502, "SLACK_ERROR"], [{ muted: true }, 200, undefined], [{}, 200, undefined]]) {
    const host = await settingsHost(t, options);
    const result = await host.request("POST", null, "manager", "/slack-test");
    assert.equal(result.status, status); assert.equal(result.data.error, code);
    if (options.muted) { assert.equal(result.data.muted, true); assert.equal(host.calls.length, 0); }
    if (status === 200 && !options.muted) {
      assert.equal(host.calls[0][0], "https://slack.com/api/chat.postMessage");
      assert.equal(host.calls[0][1].channel, "C0123ABCD");
      assert.equal(host.calls[0][2].headers.Authorization, "Bearer fake-bot-token");
    }
  }
  const host = await settingsHost(t);
  await host.request("PUT", { channelId: null });
  assert.equal((await host.request("POST", null, "manager", "/slack-test")).data.error, "SLACK_CHANNEL_MISSING");
});
test("Slack helper preserves webhook payload and boolean return", async () => {
  const { slack, calls } = slackHost();
  assert.equal(await slack.postToSlack({ text: "Fixture" }), true);
  assert.equal(calls[0][0], "https://webhook.test.invalid");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { text: "Fixture" });
  assert.equal(slack.isConfigured({ channelId: "C0123ABCD" }), true);
});
function text(tree) { return Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : typeof tree === "string" ? tree : ""; }
test("Config shows group Slack settings while passcode remains Football-only", () => {
  const groups = loadSource("../src/lib/groups.ts").exports;
  for (const gid of ["football-zigvy", "badm-1"]) {
    const fake = createFakeFirestore();
    const host = mountPage("Config", {}, {
      "@/lib/firebase": { db: fake.db }, "firebase/firestore": fake.firestore,
      "@/contexts/GroupContext": { useGroup: () => ({ groupId: gid, group: { sport: gid === "football-zigvy" ? "football" : "badminton" } }) },
      "@/lib/features": loadSource("../src/lib/features.ts", { "@/lib/groups": groups }).exports,
      "@/contexts/AuthContext": { useAuth: () => ({ user: { uid: "fixture" } }) },
      "@/components/ui/use-toast": { useToast: () => ({ toast() {} }) }, "@/lib/api": { apiRequest: async () => ({ botConfigured: false }) },
    });
    const content = text(host.render());
    assert.ok(content.includes("Thông báo Slack"));
    assert.equal(content.includes("Passcode gửi đội hình"), gid === "football-zigvy");
  }
});
