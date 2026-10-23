function createTelegramClient({ token = process.env.TELEGRAM_BOT_TOKEN, fetchImpl = fetch } = {}) {
  async function call(method, payload = {}) {
    if (!token) return { ok: false, error: "BOT_NOT_CONFIGURED", retryable: false };
    if (!["getMe", "getChat", "getChatAdministrators", "getChatMember", "sendMessage"].includes(method)) throw new Error("UNSUPPORTED_TELEGRAM_METHOD");
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (response.ok && data.ok) return { ok: true, result: data.result };
      if (data.parameters?.migrate_to_chat_id) return { ok: false, error: "CHAT_MIGRATED", retryable: false, migrateToChatId: String(data.parameters.migrate_to_chat_id) };
      if (data.error_code === 429) return { ok: false, error: "RATE_LIMITED", retryable: true, retryAfter: Math.max(1, Number(data.parameters?.retry_after) || 60) };
      if (data.error_code === 401) return { ok: false, error: "INVALID_BOT_TOKEN", retryable: false };
      if (data.error_code === 403) return { ok: false, error: "BOT_ACCESS_DENIED", retryable: false };
      if (data.error_code >= 500) return { ok: false, error: "TELEGRAM_UNAVAILABLE", retryable: true };
      return { ok: false, error: "INVALID_CHAT_OR_TOPIC", retryable: false };
    } catch {
      return { ok: false, error: "TELEGRAM_NETWORK_ERROR", retryable: true };
    }
  }
  async function send({ chatId, topicId, text }) {
    if (typeof chatId !== "string" || !/^-\d+$/.test(chatId) || typeof text !== "string" || !text || text.length > 4000 ||
        (topicId != null && (!Number.isSafeInteger(topicId) || topicId <= 0))) return { ok: false, error: "INVALID_MESSAGE", retryable: false };
    const result = await call("sendMessage", { chat_id: chatId, text, ...(topicId ? { message_thread_id: topicId } : {}) });
    return result.ok ? { ok: true, messageId: result.result.message_id } : result;
  }
  return { call, send, configured: !!token };
}

module.exports = { createTelegramClient };
