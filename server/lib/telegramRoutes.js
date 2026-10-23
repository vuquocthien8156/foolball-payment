const express = require("express");
const { createHash, timingSafeEqual } = require("node:crypto");
const { createAuthMiddleware } = require("./auth");
const { createTelegramClient } = require("./telegram");
const { createTelegramConnections } = require("./telegramConnections");

function createTelegramRouter({ db, auth, FieldValue, env = process.env, clientFactory = createTelegramClient }) {
  const router = express.Router();
  const { requireUser } = createAuthMiddleware({ db, auth });
  const service = () => createTelegramConnections({ db, FieldValue, client: clientFactory({ token: env.TELEGRAM_BOT_TOKEN }) });
  const route = (handler) => async (req, res) => {
    try { res.json(await handler(req)); }
    catch (error) { if (!error.status) console.error("Telegram operation failed"); res.status(error.status || 500).json({ error: error.status ? error.message : "INTERNAL_ERROR" }); }
  };
  router.get("/groups/:groupId/settings/telegram", requireUser, route((req) => service().settings(req.params.groupId, req.uid)));
  router.put("/groups/:groupId/settings/telegram", requireUser, route((req) => service().save(req.params.groupId, req.uid, req.body)));
  router.post("/groups/:groupId/settings/telegram-test", requireUser, route((req) => service().test(req.params.groupId, req.uid)));
  router.post("/groups/:groupId/telegram/connections", requireUser, route((req) => service().create(req.params.groupId, req.uid)));
  router.get("/groups/:groupId/telegram/connections/:id", requireUser, route((req) => service().status(req.params.groupId, req.params.id, req.uid)));
  router.post("/groups/:groupId/telegram/connections/:id/confirm", requireUser, route((req) => service().confirm(req.params.groupId, req.params.id, req.uid)));
  router.delete("/groups/:groupId/telegram/connection", requireUser, route((req) => service().disconnect(req.params.groupId, req.uid)));
  router.post("/telegram/webhook", (req, res, next) => {
    const supplied = req.get("X-Telegram-Bot-Api-Secret-Token");
    const expected = env.TELEGRAM_WEBHOOK_SECRET;
    const digest = (value) => createHash("sha256").update(value).digest();
    if (!expected || typeof supplied !== "string" || !timingSafeEqual(digest(expected), digest(supplied))) return res.status(401).json({ error: "INVALID_WEBHOOK_SECRET" });
    next();
  }, route((req) => service().receive(req.body)));
  return router;
}

module.exports = { createTelegramRouter };
