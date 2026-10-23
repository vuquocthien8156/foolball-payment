const express = require("express");
const { createAuthMiddleware } = require("./auth");
const { isValidGroupId } = require("./groups");
const { createBillService, validId } = require("./bills");
const { createSubscriptionService } = require("./scheduledBills");

function createBillRouter({ db, auth, FieldValue }) {
  const router = express.Router();
  const service = createBillService({ db, FieldValue });
  const subscriptions = createSubscriptionService({ db, FieldValue });
  const { requireUser, requireGroupRole } = createAuthMiddleware({ db, auth });
  const route = (handler) => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (!error.status) console.error("Bill operation failed", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : "INTERNAL_ERROR" });
    }
  };
  router.use("/:groupId/bills", requireUser, (req, res, next) => {
    if (!isValidGroupId(req.params.groupId)) return res.status(400).json({ error: "INVALID_GROUP" });
    next();
  }, requireGroupRole({ manager: true }));
  router.get("/:groupId/bills", route(async (req, res) => res.json(await service.list(req.params.groupId))));
  router.get("/:groupId/bills/members", route(async (req, res) => res.json(await service.members(req.params.groupId))));
  router.put("/:groupId/bills/members/:memberId", route(async (req, res) => res.json(await service.saveMember(req.params.groupId, req.params.memberId, req.body, req.uid))));
  router.post("/:groupId/bills", route(async (req, res) => {
    if (!validId(req.body?.requestId)) return res.status(400).json({ error: "REQUEST_ID_REQUIRED" });
    const result = await service.create({ groupId: req.params.groupId, billId: req.body.requestId, input: req.body, actorUid: req.uid });
    res.status(result.duplicate ? 200 : 201).json(result);
  }));
  router.get("/:groupId/bills/:billId", route(async (req, res) => res.json(await service.detail(req.params.groupId, req.params.billId))));
  router.get("/:groupId/bills/:billId/reminder-preview", route(async (req, res) => res.json(await service.remind(req.params.groupId, req.params.billId, req.uid, null, true))));
  router.post("/:groupId/bills/:billId/reminders", route(async (req, res) => res.json(await service.remind(req.params.groupId, req.params.billId, req.uid, req.body?.requestId))));
  router.post("/:groupId/bills/:billId/void", route(async (req, res) => res.json(await service.voidBill(req.params.groupId, req.params.billId, req.uid, req.body?.reason))));
  router.post("/:groupId/bills/:billId/payments", route(async (req, res) => res.json(await service.payment({
    groupId: req.params.groupId, billId: req.params.billId, actorUid: req.uid,
    memberId: req.body?.memberId, requestId: req.body?.requestId, action: req.body?.action,
    note: req.body?.note, transferReference: req.body?.transferReference,
  }))));
  router.use("/:groupId/subscriptions", requireUser, (req, res, next) => {
    if (!isValidGroupId(req.params.groupId)) return res.status(400).json({ error: "INVALID_GROUP" });
    next();
  }, requireGroupRole({ manager: true }));
  router.get("/:groupId/subscriptions", route(async (req, res) => res.json(await subscriptions.list(req.params.groupId))));
  router.put("/:groupId/subscriptions/:subscriptionId", route(async (req, res) => res.json(await subscriptions.save(req.params.groupId, req.params.subscriptionId, req.body, req.uid))));
  router.post("/:groupId/subscriptions/:subscriptionId/pause", route(async (req, res) => res.json(await subscriptions.pause(req.params.groupId, req.params.subscriptionId, req.uid))));
  router.post("/:groupId/subscriptions/:subscriptionId/resume", route(async (req, res) => res.json(await subscriptions.resume(req.params.groupId, req.params.subscriptionId, req.body?.startMonth, req.uid))));
  return router;
}

module.exports = { createBillRouter };
