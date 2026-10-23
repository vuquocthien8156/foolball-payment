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

  // Payout Recipient Settings (VietQR / Bank Account)
  const payoutRef = (gid) => db.collection("groups").doc(gid).collection("settings").doc("payout");
  router.get("/:groupId/settings/payout", ...manager, wrap(async (req, res) => {
    const snap = await payoutRef(req.params.groupId).get();
    const data = snap.exists ? snap.data() : {};
    res.json({
      bankBin: data.bankBin || "",
      bankName: data.bankName || "",
      accountNumber: data.accountNumber || "",
      accountHolder: data.accountHolder || "",
      qrCodeUrl: data.qrCodeUrl || "",
    });
  }));

  router.put("/:groupId/settings/payout", ...manager, wrap(async (req, res) => {
    const { bankBin, bankName, accountNumber, accountHolder, qrCodeUrl } = req.body;
    await payoutRef(req.params.groupId).set({
      bankBin: typeof bankBin === "string" ? bankBin.trim() : "",
      bankName: typeof bankName === "string" ? bankName.trim() : "",
      accountNumber: typeof accountNumber === "string" ? accountNumber.trim() : "",
      accountHolder: typeof accountHolder === "string" ? accountHolder.trim().toUpperCase() : "",
      qrCodeUrl: typeof qrCodeUrl === "string" ? qrCodeUrl.trim() : "",
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    res.json({ ok: true });
  }));

  // Match Payout Settlement Status
  router.post("/:groupId/matches/:matchId/payout", ...manager, wrap(async (req, res) => {
    const matchRef = db.collection("matches").doc(req.params.matchId);
    const snap = await matchRef.get();
    if (!snap.exists) return res.status(404).json({ error: "MATCH_NOT_FOUND" });
    const matchData = snap.data();
    if (matchData.groupId && matchData.groupId !== req.params.groupId) {
      return res.status(403).json({ error: "MATCH_WRONG_GROUP" });
    }

    const validStatuses = ["PAID_OUT", "READY_FOR_PAYOUT", "COLLECTING"];
    const status = validStatuses.includes(req.body.payoutStatus) ? req.body.payoutStatus : "PAID_OUT";
    const updateData = {
      payoutStatus: status,
      payoutNote: typeof req.body.note === "string" ? req.body.note.trim() : "",
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (status === "PAID_OUT") {
      updateData.paidOutAt = FieldValue.serverTimestamp();
      updateData.paidOutBy = req.uid;
    } else {
      updateData.paidOutAt = null;
      updateData.paidOutBy = null;
    }

    await matchRef.update(updateData);
    res.json({ ok: true, payoutStatus: status });
  }));

  // Batch Payout for Matches in Group
  router.post("/:groupId/matches/batch-payout", ...manager, wrap(async (req, res) => {
    const { matchIds, allPast, note } = req.body;
    let targetIds = Array.isArray(matchIds) ? matchIds : [];
    if (allPast) {
      const snap = await db.collection("matches")
        .where("groupId", "==", req.params.groupId)
        .get();
      const nowMs = Date.now();
      snap.docs.forEach((d) => {
        const m = d.data();
        if (m.payoutStatus !== "PAID_OUT") {
          const dTime = m.date?.toDate ? m.date.toDate().getTime() : (new Date(m.date)).getTime();
          if (dTime < nowMs) {
            targetIds.push(d.id);
          }
        }
      });
    }

    if (targetIds.length === 0) {
      return res.json({ ok: true, count: 0 });
    }

    const batch = db.batch();
    targetIds.forEach((mId) => {
      batch.update(db.collection("matches").doc(mId), {
        payoutStatus: "PAID_OUT",
        paidOutAt: FieldValue.serverTimestamp(),
        paidOutBy: req.uid,
        payoutNote: note || "Batch settled by Manager",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    res.json({ ok: true, count: targetIds.length });
  }));

  // Match Templates CRUD
  const templatesCol = (gid) => db.collection("groups").doc(gid).collection("templates");
  router.get("/:groupId/templates", ...manager, wrap(async (req, res) => {
    const snap = await templatesCol(req.params.groupId).get();
    const templates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    templates.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || (a.name || "").localeCompare(b.name || ""));
    res.json(templates);
  }));

  router.post("/:groupId/templates", ...manager, wrap(async (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "INVALID_NAME" });

    const templateId = req.body.id || templatesCol(req.params.groupId).doc().id;
    const docRef = templatesCol(req.params.groupId).doc(templateId);

    // If set as default, unset any existing default in this group
    if (req.body.isDefault) {
      const allTemplates = await templatesCol(req.params.groupId).get();
      const batch = db.batch();
      allTemplates.docs.forEach((d) => {
        if (d.id !== templateId && d.data().isDefault) {
          batch.update(d.ref, { isDefault: false });
        }
      });
      await batch.commit();
    }

    const payload = {
      name,
      isDefault: Boolean(req.body.isDefault),
      venueName: typeof req.body.venueName === "string" ? req.body.venueName.trim() : "",
      totalAmount: Number(req.body.totalAmount) || 0,
      mapIframe: typeof req.body.mapIframe === "string" ? req.body.mapIframe.trim() : "",
      attendanceCloseHours: req.body.attendanceCloseHours !== undefined ? Number(req.body.attendanceCloseHours) : 12,
      sufficientPlayerCount: req.body.sufficientPlayerCount ? Number(req.body.sufficientPlayerCount) : null,
      paidByMemberId: req.body.paidByMemberId || null,
      kickoffTime: typeof req.body.kickoffTime === "string" ? req.body.kickoffTime : "19:00",
      teamCount: req.body.teamCount === 3 ? 3 : 2,
      expenseItems: Array.isArray(req.body.expenseItems) ? req.body.expenseItems : [],
      teamsConfig: Array.isArray(req.body.teamsConfig) ? req.body.teamsConfig : null,
      schedule: req.body.schedule ? {
        enabled: Boolean(req.body.schedule.enabled),
        dayOfWeek: Number(req.body.schedule.dayOfWeek ?? 2),
        createHour: Number(req.body.schedule.createHour ?? 9),
        matchDayOfWeek: Number(req.body.schedule.matchDayOfWeek ?? 4),
        matchTime: req.body.schedule.matchTime || "19:00",
      } : null,
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await docRef.set(payload, { merge: true });
    res.status(201).json({ id: templateId, ...payload });
  }));

  router.delete("/:groupId/templates/:templateId", ...manager, wrap(async (req, res) => {
    await templatesCol(req.params.groupId).doc(req.params.templateId).delete();
    res.json({ ok: true });
  }));

  // Automated Scheduled Attendance Settings
  const scheduleRef = (gid) => db.collection("groups").doc(gid).collection("settings").doc("schedule");
  router.get("/:groupId/settings/schedule", ...manager, wrap(async (req, res) => {
    const snap = await scheduleRef(req.params.groupId).get();
    const data = snap.exists ? snap.data() : {};
    res.json({
      enabled: Boolean(data.enabled),
      dayOfWeek: data.dayOfWeek !== undefined ? Number(data.dayOfWeek) : 2, // Tuesday default
      createHour: data.createHour !== undefined ? Number(data.createHour) : 9, // 09:00 AM
      matchDayOfWeek: data.matchDayOfWeek !== undefined ? Number(data.matchDayOfWeek) : 4, // Thursday
      matchTime: data.matchTime || "19:00",
      templateId: data.templateId || null,
      lastTriggeredDate: data.lastTriggeredDate || null,
      lastCreatedMatchId: data.lastCreatedMatchId || null,
    });
  }));

  router.put("/:groupId/settings/schedule", ...manager, wrap(async (req, res) => {
    const { enabled, dayOfWeek, createHour, matchDayOfWeek, matchTime, templateId } = req.body;
    await scheduleRef(req.params.groupId).set({
      enabled: Boolean(enabled),
      dayOfWeek: Number(dayOfWeek ?? 2),
      createHour: Number(createHour ?? 9),
      matchDayOfWeek: Number(matchDayOfWeek ?? 4),
      matchTime: typeof matchTime === "string" ? matchTime : "19:00",
      templateId: templateId || null,
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    res.json({ ok: true });
  }));

  router.post("/:groupId/settings/schedule/run-now", ...manager, wrap(async (req, res) => {
    const { createMatchFromTemplate } = require("./scheduledMatches");
    const scheduleSnap = await scheduleRef(req.params.groupId).get();
    const schedule = scheduleSnap.exists ? scheduleSnap.data() : {};
    const templateId = req.body.templateId || schedule.templateId || null;

    const result = await createMatchFromTemplate({
      db,
      FieldValue,
      groupId: req.params.groupId,
      templateId,
      creatorUid: req.uid,
    });

    res.status(201).json({ ok: true, matchId: result.matchId, date: result.date });
  }));

  return router;
}
module.exports = { createGroupRouter };
