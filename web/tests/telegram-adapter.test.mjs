import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTelegramClient } = require("../../server/lib/telegram.js");

test("Telegram sends scoped text and exposes only safe errors", async () => {
  const calls = [];
  const client = createTelegramClient({ token: "test-private-token", fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
  } });
  assert.deepEqual(await client.send({ chatId: "-100123", text: "Netflix", topicId: 12 }), { ok: true, messageId: 42 });
  assert.equal(calls[0].body.chat_id, "-100123");
  assert.equal(calls[0].body.message_thread_id, 12);
  const broken = createTelegramClient({ token: "test-private-token", fetchImpl: async () => { throw new Error("https://api.telegram.org/bottest-private-token/sendMessage"); } });
  const result = await broken.send({ chatId: "-100123", text: "Netflix" });
  assert.equal(result.retryable, true);
  assert.equal(JSON.stringify(result).includes("test-private-token"), false);
});

test("Telegram rate limits and migration have actionable results; missing token sends nothing", async () => {
  const throttled = createTelegramClient({ token: "secret", fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 12 } }) }) });
  assert.deepEqual(await throttled.send({ chatId: "-100123", text: "x" }), { ok: false, error: "RATE_LIMITED", retryable: true, retryAfter: 12 });
  const missing = createTelegramClient({ token: "", fetchImpl: () => { throw new Error("must not send"); } });
  assert.equal((await missing.send({ chatId: "-1", text: "x" })).error, "BOT_NOT_CONFIGURED");
});
