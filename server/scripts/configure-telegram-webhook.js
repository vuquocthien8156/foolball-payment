async function configureWebhook({ token, secret, webhookUrl, apply = false, fetchImpl = fetch }) {
  if (typeof token !== "string" || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error("A valid bot token is required through the environment.");
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error("Use a webhook secret of 16–256 letters, digits, underscores or hyphens.");
  const url = new URL(webhookUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/api/telegram/webhook")) throw new Error("Use the deployed HTTPS URL ending in /api/telegram/webhook.");
  if (!apply) return { applied: false, webhookUrl: url.toString(), message: "Validation passed. Add --apply to register the webhook." };
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.toString(), secret_token: secret, allowed_updates: ["message", "my_chat_member"] }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error("Telegram rejected the webhook configuration. Check the deployed URL and bot credentials.");
  return { applied: true, webhookUrl: url.toString() };
}

if (require.main === module) configureWebhook({ token: process.env.TELEGRAM_BOT_TOKEN,
  secret: process.env.TELEGRAM_WEBHOOK_SECRET, webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
  apply: process.argv.includes("--apply"),
}).then((result) => console.log(JSON.stringify(result))).catch(() => {
  // Never log fetch exceptions: their URLs may contain the bot token.
  console.error("Webhook setup failed. Check the secret environment variables and the deployed HTTPS URL.");
  process.exitCode = 1;
});

module.exports = { configureWebhook };
