const { randomBytes, createHash } = require("node:crypto");
const { resolveGroupRole } = require("./auth");
const { isValidGroupId } = require("./groups");
const { reject } = require("./bills");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function createTelegramConnections({ db, FieldValue, client, now = () => new Date() }) {
  const settingsRef = (gid) => db.doc(`groups/${gid}/settings/telegram`);
  async function authorize(gid, uid) {
    if (!isValidGroupId(gid)) reject(400, "INVALID_GROUP");
    const [role, group] = await Promise.all([resolveGroupRole(db, uid, gid), db.doc(`groups/${gid}`).get()]);
    if (!role || !["owner", "manager"].includes(role.role)) reject(403, "GROUP_ACCESS_DENIED");
    if (!group.exists || group.data().status !== "active") reject(403, "GROUP_INACTIVE");
  }
  function checkAttempt(attempt, gid, uid) {
    if (!attempt || attempt.groupId !== gid || attempt.createdBy !== uid) reject(404, "CONNECTION_NOT_FOUND");
    if (attempt.expiresAt <= now().getTime()) reject(410, "CONNECTION_EXPIRED");
  }
  async function settings(gid, uid) {
    await authorize(gid, uid);
    const data = (await settingsRef(gid).get()).data() || {};
    return { configured: client.configured, enabled: !!data.enabled, chatId: data.chatId || null, chatLabel: data.chatLabel || "",
      topicId: data.topicId || null, events: data.events || ["opened", "due", "overdue"], version: data.version || 0,
      pendingAttemptId: data.pendingAttemptId || null, lastTestAt: data.lastTestAt ? { seconds: data.lastTestAt.seconds } : null, lastError: data.lastError || null };
  }
  async function create(gid, uid) {
    await authorize(gid, uid);
    const bot = await client.call("getMe");
    if (!bot.ok) reject(503, bot.error);
    const token = randomBytes(24).toString("base64url");
    const id = hash(token), expiresAt = now().getTime() + 600000;
    const ref = db.doc(`telegramConnections/${id}`);
    await db.runTransaction(async (tx) => {
      tx.set(ref, { groupId: gid, createdBy: uid, expiresAt, state: "waiting", createdAt: FieldValue.serverTimestamp() });
      tx.set(settingsRef(gid), { pendingAttemptId: id }, { merge: true });
    });
    return { id, expiresAt, url: `https://t.me/${bot.result.username}?startgroup=${token}`, command: `/start@${bot.result.username} ${token}` };
  }
  async function status(gid, id, uid) {
    await authorize(gid, uid);
    if (!/^[a-f0-9]{64}$/.test(id)) reject(400, "INVALID_CONNECTION");
    const attempt = (await db.doc(`telegramConnections/${id}`).get()).data();
    checkAttempt(attempt, gid, uid);
    return { id, state: attempt.state, expiresAt: attempt.expiresAt, chatLabel: attempt.chatLabel || null, chatId: attempt.chatId || null };
  }
  async function receive(update) {
    const membershipChange = update?.my_chat_member;
    if (Number.isSafeInteger(update?.update_id) && Number.isSafeInteger(membershipChange?.chat?.id) &&
        (["left", "kicked"].includes(membershipChange.new_chat_member?.status) ||
          (membershipChange.new_chat_member?.status === "restricted" && membershipChange.new_chat_member.can_send_messages === false))) {
      const chatId = String(membershipChange.chat.id);
      return db.runTransaction(async (tx) => {
        const claim = await tx.get(db.doc(`telegramDestinations/${chatId}`));
        if (!claim.exists) return { ignored: true };
        const ref = settingsRef(claim.data().groupId);
        const settings = await tx.get(ref);
        if (settings.data()?.chatId === chatId) tx.update(ref, { enabled: false, lastError: "BOT_ACCESS_DENIED" });
        return { ok: true };
      });
    }
    const message = update?.message;
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0 || !message || message.sender_chat || message.from?.is_bot ||
        !Number.isSafeInteger(message.from?.id) || !["group", "supergroup"].includes(message.chat?.type) || !Number.isSafeInteger(message.chat.id)) return { ignored: true };
    const match = /^\/start(?:@([a-zA-Z0-9_]+))?\s+([a-zA-Z0-9_-]{22,64})$/.exec(message.text || "");
    if (!match) return { ignored: true };
    const bot = await client.call("getMe");
    if (!bot.ok) reject(503, bot.error);
    if (match[1] && match[1].toLowerCase() !== bot.result.username.toLowerCase()) return { ignored: true };
    const ref = db.doc(`telegramConnections/${hash(match[2])}`);
    const initial = (await ref.get()).data();
    if (!initial || initial.expiresAt <= now().getTime() || initial.state !== "waiting") return { ignored: true };
    const chatId = String(message.chat.id);
    const [admins, chat, membership] = await Promise.all([
      client.call("getChatAdministrators", { chat_id: chatId }), client.call("getChat", { chat_id: chatId }),
      client.call("getChatMember", { chat_id: chatId, user_id: bot.result.id }),
    ]);
    if (!admins.ok || !chat.ok || !membership.ok) reject(503, "TELEGRAM_VERIFICATION_FAILED");
    if (!admins.result.some((admin) => admin.user.id === message.from.id && ["creator", "administrator"].includes(admin.status)) ||
        !["group", "supergroup"].includes(chat.result.type) || ["left", "kicked"].includes(membership.result.status)) return { ignored: true };
    return db.runTransaction(async (tx) => {
      const receipt = db.doc(`telegramUpdates/${update.update_id}`);
      const [snap, prior, settings] = await tx.getAll(ref, receipt, settingsRef(initial.groupId));
      if (prior.exists || !snap.exists || snap.data().state !== "waiting" || snap.data().expiresAt <= now().getTime() || settings.data()?.pendingAttemptId !== ref.id) return { ignored: true };
      tx.update(ref, { state: "detected", chatId, chatLabel: chat.result.title || chatId, telegramSenderId: String(message.from.id) });
      tx.set(receipt, { processedAt: FieldValue.serverTimestamp() });
      return { ok: true };
    });
  }
  async function confirm(gid, id, uid) {
    await authorize(gid, uid);
    if (!/^[a-f0-9]{64}$/.test(id)) reject(400, "INVALID_CONNECTION");
    const ref = db.doc(`telegramConnections/${id}`);
    return db.runTransaction(async (tx) => {
      const [attempt, settings, account, group, membership] = await tx.getAll(ref, settingsRef(gid),
        db.doc(`platformAccounts/${uid}`), db.doc(`groups/${gid}`), db.doc(`groupMembers/${gid}_${uid}`));
      const data = attempt.data(), prior = settings.data() || {};
      checkAttempt(data, gid, uid);
      if (account.exists && account.data().status !== "active") reject(403, "GROUP_ACCESS_DENIED");
      if (!group.exists || group.data().status !== "active" || !(group.data().ownerUid === uid || account.data()?.role === "owner" || membership.data()?.role === "manager")) reject(403, "GROUP_ACCESS_DENIED");
      if (data.state === "connected" && prior.chatId === data.chatId) return { ok: true, duplicate: true };
      if (data.state !== "detected" || prior.pendingAttemptId !== id) reject(409, "CONNECTION_NOT_READY");
      const claimRef = db.doc(`telegramDestinations/${data.chatId}`);
      const claim = await tx.get(claimRef);
      const oldClaimRef = prior.chatId && prior.chatId !== data.chatId ? db.doc(`telegramDestinations/${prior.chatId}`) : null;
      const oldClaim = oldClaimRef ? await tx.get(oldClaimRef) : null;
      if (claim.exists && claim.data().groupId !== gid) reject(409, "DESTINATION_ALREADY_CONNECTED");
      if (oldClaim?.data()?.groupId === gid) tx.delete(oldClaimRef);
      tx.set(claimRef, { groupId: gid });
      tx.set(settingsRef(gid), { chatId: data.chatId, chatLabel: data.chatLabel, version: (prior.version || 0) + 1,
        enabled: false, topicId: null, lastTestVersion: null, lastError: null, pendingAttemptId: null, events: prior.events || ["opened", "due", "overdue"] }, { merge: true });
      tx.update(ref, { state: "connected", connectedAt: FieldValue.serverTimestamp() });
      return { ok: true };
    });
  }
  async function disconnect(gid, uid) {
    await authorize(gid, uid);
    await db.runTransaction(async (tx) => {
      const settings = await tx.get(settingsRef(gid));
      const data = settings.data() || {};
      const claimRef = data.chatId ? db.doc(`telegramDestinations/${data.chatId}`) : null;
      const claim = claimRef ? await tx.get(claimRef) : null;
      if (claim?.data()?.groupId === gid) tx.delete(claimRef);
      tx.set(settingsRef(gid), { enabled: false, chatId: null, chatLabel: "", pendingAttemptId: null, lastTestVersion: null, version: (data.version || 0) + 1 }, { merge: true });
    });
    return { ok: true };
  }
  async function save(gid, uid, input) {
    await authorize(gid, uid);
    if (typeof input.enabled !== "boolean" || !Array.isArray(input.events) || input.events.some((event) => !["opened", "due", "overdue"].includes(event)) ||
        (input.topicId != null && (!Number.isSafeInteger(input.topicId) || input.topicId <= 0)) || input.chatId !== undefined) reject(400, "INVALID_TELEGRAM_SETTINGS");
    await db.runTransaction(async (tx) => {
      const data = (await tx.get(settingsRef(gid))).data() || {};
      const topicChanged = (data.topicId || null) !== (input.topicId || null);
      if (input.enabled && (!data.chatId || !client.configured || topicChanged || data.lastTestVersion !== data.version || data.lastError)) reject(409, "SEND_TEST_BEFORE_ENABLING");
      tx.set(settingsRef(gid), { enabled: input.enabled, events: [...new Set(input.events)], topicId: input.topicId || null,
        ...(topicChanged ? { version: (data.version || 0) + 1, lastTestVersion: null } : {}), updatedBy: uid }, { merge: true });
    });
    return { ok: true };
  }
  async function test(gid, uid) {
    await authorize(gid, uid);
    const data = await db.runTransaction(async (tx) => {
      const saved = (await tx.get(settingsRef(gid))).data();
      if (!saved?.chatId) reject(409, "CONNECT_GROUP_FIRST");
      if (saved.lastTestRequestedAt && now().getTime() - saved.lastTestRequestedAt < 30000) reject(429, "TEST_COOLDOWN");
      tx.update(settingsRef(gid), { lastTestRequestedAt: now().getTime() });
      return saved;
    });
    const result = await client.send({ chatId: data.chatId, topicId: data.topicId, text: "Tin nhắn thử: nhóm chia tiền đã kết nối thành công. Không có khoản thu hay thanh toán nào được tạo." });
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(settingsRef(gid))).data();
      if (current?.version === data.version) tx.update(settingsRef(gid), { lastTestAt: FieldValue.serverTimestamp(), lastError: result.ok ? null : result.error, lastTestVersion: result.ok ? data.version : null });
    });
    if (!result.ok) reject(result.retryable ? 503 : 400, result.error);
    return { ok: true };
  }
  return { settings, create, status, receive, confirm, disconnect, save, test };
}

module.exports = { createTelegramConnections };
