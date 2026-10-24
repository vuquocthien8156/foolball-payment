const express = require("express");
const { groupIdOf, isValidGroupId, groupKindOf } = require("./groups");

const validId = (value) => typeof value === "string" && value.length > 0 && value !== "." && value !== ".." && !value.includes("/");
const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };

function parseDeviceDetails(userAgent = "", screen = "", platform = "") {
  let model = "Thiết bị không xác định";
  const ua = String(userAgent);
  const scr = String(screen);

  if (/iPhone/i.test(ua)) {
    if (scr.includes("430x932") || scr.includes("932x430")) {
      model = "iPhone 15 Pro Max / 15 Plus / 14 Pro Max";
    } else if (scr.includes("393x852") || scr.includes("852x393")) {
      model = "iPhone 15 Pro / 15 / 14 Pro";
    } else if (scr.includes("390x844") || scr.includes("844x390")) {
      model = "iPhone 14 / 13 / 13 Pro / 12";
    } else if (scr.includes("414x896") || scr.includes("896x414")) {
      model = "iPhone 11 / XR / XS Max";
    } else if (scr.includes("375x812") || scr.includes("812x375")) {
      model = "iPhone 13 mini / 12 mini / X / XS";
    } else if (scr.includes("375x667") || scr.includes("667x375")) {
      model = "iPhone SE / 8 / 7";
    } else {
      model = "iPhone (iOS)";
    }
  } else if (/iPad/i.test(ua)) {
    model = "iPad (iPadOS)";
  } else if (/Android/i.test(ua)) {
    const match = ua.match(/;\s*([^;)]+?)\s+Build\//i) || ua.match(/\(([^;)]+);\s*Android/i);
    const rawModel = match ? match[1].replace(/Linux;\s*/i, "").trim() : "";
    if (rawModel) {
      model = `Android (${rawModel})`;
    } else {
      model = "Điện thoại Android";
    }
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    model = "Máy tính MacBook (macOS)";
  } else if (/Windows/i.test(ua)) {
    model = "Máy tính Windows";
  } else if (/Linux/i.test(ua)) {
    model = "Máy tính Linux";
  }

  return model;
}

function createPublicRouter({ db, FieldValue, Timestamp, onMemberAction }) {
  const router = express.Router();
  const route = (handler) => async (req, res) => {
    try {
      if (!isValidGroupId(req.params.groupId)) reject(400, "INVALID_GROUP");
      res.json(await handler(req));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : "INTERNAL_ERROR" });
    }
  };
  const inGroup = (gid, operation) => db.runTransaction(async (transaction) => {
    const group = await transaction.get(db.collection("groups").doc(gid));
    if (!group.exists) reject(404, "NOT_FOUND");
    if (group.data().status !== "active") reject(403, "GROUP_INACTIVE");
    if (groupKindOf(group.data()) !== "sports") reject(400, "SPORTS_NOT_SUPPORTED");
    return operation(transaction);
  });
  const checkRecord = (snapshot, gid) => {
    if (!snapshot.exists) reject(404, "NOT_FOUND");
    if (groupIdOf(snapshot.data()) !== gid) reject(409, "MIXED_GROUP");
    return snapshot.data();
  };

  router.post("/:groupId/attendance", route(async (req) => {
    const { matchId, memberId, action, deviceId, screen, platform, actorMemberId } = req.body || {};
    if (!validId(matchId) || !validId(memberId) || !["attending", "not_attending"].includes(action)) reject(400, "INVALID_ATTENDANCE");
    const groupId = req.params.groupId;
    const clientIp = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const userAgent = req.get("User-Agent") || "";
    const deviceModel = parseDeviceDetails(userAgent, screen, platform);

    const result = await inGroup(groupId, async (transaction) => {
      const matchRef = db.collection("matches").doc(matchId);
      const attendanceRef = matchRef.collection("attendance").doc(memberId);
      const notAttendanceRef = matchRef.collection("not_attending").doc(memberId);
      const refs = [matchRef, db.collection("members").doc(memberId), attendanceRef, notAttendanceRef];
      const validActorId = validId(actorMemberId) ? actorMemberId : null;
      if (validActorId) refs.push(db.collection("members").doc(validActorId));

      const snaps = await transaction.getAll(...refs);
      const [matchSnap, memberSnap, attendance, notAttendance] = snaps.slice(0, 4);
      const actorSnap = validActorId && snaps[4] ? snaps[4] : null;

      const match = checkRecord(matchSnap, groupId);
      const member = checkRecord(memberSnap, groupId);
      const actorName = actorSnap?.exists ? actorSnap.data().name : null;
      const isProxyAction = Boolean(validActorId && validActorId !== memberId);

      if (match.status !== "PENDING") reject(409, "MATCH_NOT_PENDING");
      if ((action === "attending" && attendance.exists) || (action === "not_attending" && notAttendance.exists)) return { skipped: true, actions: [] };
      const memberName = member.name || "Một thành viên";
      const record = { timestamp: Timestamp.now(), memberName, userAgent };
      transaction.set(action === "attending" ? attendanceRef : notAttendanceRef, record);
      transaction.delete(action === "attending" ? notAttendanceRef : attendanceRef);
      const logType = action === "attending" ? "ATTEND" : attendance.exists ? "CANCEL_ATTEND" : "NOT_ATTEND";
      const logData = {
        memberId,
        memberName,
        userAgent,
        timestamp: FieldValue.serverTimestamp(),
        type: logType,
      };
      if (deviceId) {
        logData.deviceId = typeof deviceId === "string" ? deviceId.slice(0, 64) : null;
        logData.deviceModel = deviceModel;
        if (screen) logData.screen = typeof screen === "string" ? screen.slice(0, 32) : null;
        if (clientIp) logData.clientIp = clientIp;
        if (validActorId) {
          logData.actorMemberId = validActorId;
          logData.actorName = actorName;
          logData.isProxyAction = isProxyAction;
        }
      }
      transaction.set(matchRef.collection("attendanceLog").doc(), logData);
      // Preserve the existing logs: CANCEL_NOT_ATTEND is a notification action only.
      const actions = action === "attending" && notAttendance.exists ? ["CANCEL_NOT_ATTEND", "ATTEND"] : [logType];
      return { skipped: false, actions, match, memberName };
    });
    for (const action of result.actions) {
      try {
        await onMemberAction({ groupId, matchId, memberId, memberName: result.memberName, match: result.match, action });
      } catch {
        // Attendance already committed; notification failures must not fail the public write.
        console.error("Failed to notify attendance action");
      }
    }
    return { success: true, skipped: result.skipped };
  }));

  router.post("/:groupId/auto-attendance", route(async (req) => {
    const { memberId, enabled } = req.body || {};
    if (!validId(memberId) || typeof enabled !== "boolean") reject(400, "INVALID_AUTO_ATTENDANCE");
    await inGroup(req.params.groupId, async (transaction) => {
      const ref = db.collection("members").doc(memberId);
      checkRecord(await transaction.get(ref), req.params.groupId);
      transaction.update(ref, { autoAttendance: enabled });
    });
    return { success: true };
  }));

  router.post("/:groupId/notification-token", route(async (req) => {
    const { token, memberId } = req.body || {};
    if (!validId(token) || (memberId != null && !validId(memberId))) reject(400, "INVALID_TOKEN");
    const groupId = req.params.groupId;
    await inGroup(groupId, async (transaction) => {
      const tokenRef = db.collection("notificationTokens").doc(token);
      const stored = await transaction.get(tokenRef);
      if (stored.exists) checkRecord(stored, groupId);
      const memberRef = memberId ? db.collection("members").doc(memberId) : null;
      if (memberRef) checkRecord(await transaction.get(memberRef), groupId);
      transaction.set(tokenRef, { token, groupId, memberId: memberId || null,
        updatedAt: FieldValue.serverTimestamp(), userAgent: req.get("User-Agent") || "" }, { merge: true });
      if (memberRef) transaction.set(memberRef, { fcmToken: token, fcmTokenUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    return { success: true };
  }));

  router.delete("/:groupId/notification-token", route(async (req) => {
    const { token } = req.body || {};
    if (!validId(token)) reject(400, "INVALID_TOKEN");
    const groupId = req.params.groupId;
    await inGroup(groupId, async (transaction) => {
      const tokenRef = db.collection("notificationTokens").doc(token);
      const stored = await transaction.get(tokenRef);
      if (!stored.exists) return;
      const data = checkRecord(stored, groupId);
      const memberRef = data.memberId ? db.collection("members").doc(data.memberId) : null;
      const member = memberRef ? checkRecord(await transaction.get(memberRef), groupId) : null;
      transaction.delete(tokenRef);
      if (member?.fcmToken === token) transaction.set(memberRef, { fcmToken: null, fcmTokenUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    return { success: true };
  }));

  router.get("/:groupId/shared-bills", route(async (req) => {
    const gid = req.params.groupId;
    const group = await db.collection("groups").doc(gid).get();
    if (!group.exists) reject(404, "GROUP_NOT_FOUND");
    if (group.data().status !== "active") reject(403, "GROUP_INACTIVE");
    const billsSnap = await db.collection(`groups/${gid}/bills`).where("state", "==", "open").limit(5).get();
    const payoutSnap = await db.doc(`groups/${gid}/settings/payout`).get();
    const payout = payoutSnap.exists ? payoutSnap.data() : null;
    const bills = await Promise.all(billsSnap.docs.map(async (bDoc) => {
      const bData = bDoc.data();
      const aSnap = await bDoc.ref.collection("allocations").get();
      return {
        id: bDoc.id,
        title: bData.title,
        amountVnd: bData.amountVnd,
        billingDate: bData.billingDate,
        dueDate: bData.dueDate,
        providerPayerMemberId: bData.providerPayerMemberId,
        allocations: aSnap.docs.map((a) => ({ id: a.id, ...a.data() })),
      };
    }));
    return {
      group: { name: group.data().name, kind: group.data().kind },
      bills,
      payout: payout ? {
        bankBin: payout.bankBin,
        bankName: payout.bankName,
        accountNumber: payout.accountNumber,
        accountHolder: payout.accountHolder,
        qrCodeUrl: payout.qrCodeUrl,
      } : null,
    };
  }));

  return router;
}

module.exports = { createPublicRouter };
