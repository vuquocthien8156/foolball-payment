import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { configureWebhook } = require("../../server/scripts/configure-telegram-webhook.js");
const input = { token: "123:test-only-token", secret: "test-only-webhook-secret", webhookUrl: "https://example.test/api/telegram/webhook" };
test("webhook setup is dry-run by default and never emits credentials", async () => {
  const result = await configureWebhook({ ...input, fetchImpl: () => { throw new Error("must not call"); } });
  assert.equal(result.applied, false);
  assert.equal(JSON.stringify(result).includes(input.token), false);
  assert.equal(JSON.stringify(result).includes(input.secret), false);
});
test("explicit webhook registration sends secret and supported updates to Telegram", async () => {
  const calls = [];
  const result = await configureWebhook({ ...input, apply: true, fetchImpl: async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) };
  } });
  assert.equal(result.applied, true);
  assert.equal(calls[0].payload.secret_token, input.secret);
  await assert.rejects(configureWebhook({ ...input, webhookUrl: "http://example.test/api/telegram/webhook" }));
});
