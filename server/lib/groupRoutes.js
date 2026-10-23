const express = require("express");
const { createAuthMiddleware } = require("./auth");
const { isValidGroupId } = require("./groups");
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(() => res.status(500).json({ error: "INTERNAL_ERROR" }));
function createGroupRouter({ db, auth, FieldValue, slack, env = process.env }) {
  const router = express.Router();
  const { requireUser, requireGroupRole } = createAuthMiddleware({ db, auth });
  const manager = [requireUser, requireGroupRole({ manager: true }), wrap(async (req, res, next) => {
    if (!isValidGroupId(req.params.groupId)) return res.status(400).json({ error: "INVALID_GROUP" });
    const group = await db.collection("groups").doc(req.params.groupId).get();
    if (!group.exists) return res.status(404).json({ error: "NOT_FOUND" });
    req.group = group.data(); next();
  })];
  const settingsRef = (gid) => db.collection("groups").doc(gid).collection("settings").doc("slack");
  router.get("/:groupId/settings", ...manager, wrap(async (req, res) => {
    const data = (await settingsRef(req.params.groupId).get()).data();
    res.json({ slackEnabled: !!data?.enabled, channelId: data?.channelId || null, channelLabel: data?.channelLabel || "", botConfigured: Boolean(env.SLACK_BOT_TOKEN) });
  }));
  router.put("/:groupId/settings", ...manager, wrap(async (req, res) => {
    const input = req.body.channelId;
    if (input !== undefined && input !== null && typeof input !== "string") return res.status(400).json({ error: "INVALID_CHANNEL" });
    const channelId = input?.trim().toUpperCase() || null;
    if (channelId && !/^[CG][A-Z0-9]{8,}$/.test(channelId)) return res.status(400).json({ error: "INVALID_CHANNEL" });
    const channelLabel = typeof req.body.channelLabel === "string" ? req.body.channelLabel.trim() : "";
    await settingsRef(req.params.groupId).set({ enabled: Boolean(channelId), channelId, channelLabel, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }));
  router.post("/:groupId/settings/slack-test", ...manager, wrap(async (req, res) => {
    if (!env.SLACK_BOT_TOKEN) return res.status(503).json({ error: "SLACK_NOT_CONFIGURED" });
    const data = (await settingsRef(req.params.groupId).get()).data();
    if (!data?.enabled || !data.channelId) return res.status(400).json({ error: "SLACK_CHANNEL_MISSING" });
    const result = await slack.postToSlackDetailed({ text: `✅ Kết nối Slack cho nhóm ${req.group.name} thành công.` }, { channelId: data.channelId });
    if (result.ok) return res.json({ ok: true, ...(result.muted ? { muted: true } : {}) });
    if (result.error === "not_in_channel") return res.status(400).json({ error: "SLACK_NOT_IN_CHANNEL" });
    if (result.error === "channel_not_found") return res.status(400).json({ error: "SLACK_CHANNEL_NOT_FOUND" });
    res.status(502).json({ error: "SLACK_ERROR", slackError: result.error });
  }));
  return router;
}
module.exports = { createGroupRouter };
