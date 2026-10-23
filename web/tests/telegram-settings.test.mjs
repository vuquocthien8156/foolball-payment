import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createFakeAuth } from "./fake-auth.mjs";
import { startRouter } from "./http-harness.mjs";
const require = createRequire(import.meta.url);
const { createTelegramConnections } = require("../../server/lib/telegramConnections.js");
const { createTelegramRouter } = require("../../server/lib/telegramRoutes.js");

function setup() {
  const fake = createFakeFirestore({
    "groups/alpha": { status: "active", ownerUid: "alice" },
    "groups/beta": { status: "active", ownerUid: "bob" },
  });
  const sends = [];
  const client = { configured: true, call: async (method, input) => {
    if (method === "getMe") return { ok: true, result: { id: 123, username: "SharedBillsBot" } };
    if (method === "getChatAdministrators") return { ok: true, result: [{ user: { id: 10 }, status: "administrator" }] };
    if (method === "getChatMember") return { ok: true, result: { status: "member" } };
    return { ok: true, result: { id: input.chat_id, type: "supergroup", title: `Chat ${input.chat_id}` } };
  }, send: async (payload) => { sends.push(payload); return { ok: true, messageId: 1 }; } };
  let time = new Date("2026-10-23T00:00:00Z");
  const service = createTelegramConnections({ ...fake, client, now: () => time });
  return { ...fake, service, sends, client, advance: (milliseconds) => { time = new Date(time.getTime() + milliseconds); } };
}
function update(attempt, chatId, updateId) {
  return { update_id: updateId, message: { chat: { id: chatId, type: "supergroup" }, from: { id: 10 }, text: `/start@SharedBillsBot ${new URL(attempt.url).searchParams.get("startgroup")}` } };
}

test("one bot connects separate managers/groups without revealing its token", async () => {
  const { service, records } = setup();
  const alpha = await service.create("alpha", "alice");
  const beta = await service.create("beta", "bob");
  await service.receive(update(alpha, -1001, 1));
  await service.receive(update(beta, -1002, 2));
  assert.equal((await service.status("alpha", alpha.id, "alice")).state, "detected");
  await assert.rejects(service.confirm("alpha", alpha.id, "bob"));
  await service.confirm("alpha", alpha.id, "alice");
  await service.confirm("beta", beta.id, "bob");
  assert.equal(records.get("groups/alpha/settings/telegram").chatId, "-1001");
  assert.equal(records.get("groups/beta/settings/telegram").chatId, "-1002");
  assert.equal(JSON.stringify(await service.settings("alpha", "alice")).includes("token"), false);
});

test("replayed/foreign/anonymous commands cannot overwrite a verified destination", async () => {
  const { service, records } = setup();
  const attempt = await service.create("alpha", "alice");
  const command = update(attempt, -1001, 1);
  await service.receive(command);
  await service.receive(command);
  await service.receive({ ...update(attempt, -1002, 2), message: { ...update(attempt, -1002, 2).message, sender_chat: { id: -1002 } } });
  await service.confirm("alpha", attempt.id, "alice");
  assert.equal(records.get("groups/alpha/settings/telegram").chatId, "-1001");
  const other = await service.create("beta", "bob");
  await service.receive(update(other, -1001, 3));
  await assert.rejects(service.confirm("beta", other.id, "bob"), /DESTINATION_ALREADY_CONNECTED/);
  await service.disconnect("alpha", "alice");
  assert.equal(records.get("groups/alpha/settings/telegram").enabled, false);
  assert.equal(records.has("telegramDestinations/-1001"), false);
});

test("expired attempts and revoked managers cannot confirm; competing attempts invalidate old links", async () => {
  const host = setup();
  const expired = await host.service.create("alpha", "alice");
  host.advance(600001);
  await assert.rejects(host.service.status("alpha", expired.id, "alice"), /CONNECTION_EXPIRED/);
  const first = await host.service.create("alpha", "alice");
  const second = await host.service.create("alpha", "alice");
  await host.service.receive(update(first, -1001, 1));
  assert.equal((await host.service.status("alpha", first.id, "alice")).state, "waiting");
  await host.service.receive(update(second, -1002, 2));
  host.records.set("platformAccounts/alice", { status: "disabled", role: "user" });
  await assert.rejects(host.service.confirm("alpha", second.id, "alice"), /GROUP_ACCESS_DENIED/);
});

test("verification rejects non-admins; test must succeed before enabling; cooldown is enforced", async () => {
  const host = setup();
  const attempt = await host.service.create("alpha", "alice");
  const base = update(attempt, -1001, 1);
  await host.service.receive({ ...base, message: { ...base.message, from: { id: 99 } } });
  assert.equal((await host.service.status("alpha", attempt.id, "alice")).state, "waiting");
  await host.service.receive(update(attempt, -1001, 2));
  await host.service.confirm("alpha", attempt.id, "alice");
  await assert.rejects(host.service.save("alpha", "alice", { enabled: true, topicId: null, events: ["due"] }), /SEND_TEST_BEFORE_ENABLING/);
  await host.service.test("alpha", "alice");
  await host.service.save("alpha", "alice", { enabled: true, topicId: null, events: ["due"] });
  assert.equal(host.records.get("groups/alpha/settings/telegram").enabled, true);
  await assert.rejects(host.service.test("alpha", "alice"), /TEST_COOLDOWN/);
  await assert.rejects(host.service.save("alpha", "alice", { enabled: true, topicId: null, events: ["due"], chatId: "-9999" }), /INVALID_TELEGRAM_SETTINGS/);
  await host.service.receive({ update_id: 3, my_chat_member: { chat: { id: -1001 }, new_chat_member: { status: "kicked" } } });
  assert.equal(host.records.get("groups/alpha/settings/telegram").enabled, false);
  assert.equal(host.records.get("groups/alpha/settings/telegram").lastError, "BOT_ACCESS_DENIED");
});

test("Telegram API rejects forged webhook secrets and unauthenticated Settings requests", async (t) => {
  const fixture = setup();
  const host = await startRouter(createTelegramRouter({ ...fixture, auth: createFakeAuth().auth,
    env: { TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret" }, clientFactory: () => fixture.client }));
  t.after(host.close);
  for (const secret of [undefined, "wrong-secret", "test-webhook-secret"]) {
    const res = await fetch(`${host.url}/telegram/webhook`, { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {}) }, body: "{}" });
    assert.equal(res.status, secret === "test-webhook-secret" ? 200 : 401);
  }
  const res = await fetch(`${host.url}/groups/alpha/settings/telegram`);
  assert.equal(res.status, 401);
});
