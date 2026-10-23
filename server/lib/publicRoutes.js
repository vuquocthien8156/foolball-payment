const express = require("express");
const { groupIdOf, isValidGroupId } = require("./groups");

const validId = (value) => typeof value === "string" && value.length > 0 && value !== "." && value !== ".." && !value.includes("/");
const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };

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
    return operation(transaction);
  });
  const checkRecord = (snapshot, gid) => {
    if (!snapshot.exists) reject(404, "NOT_FOUND");
    if (groupIdOf(snapshot.data()) !== gid) reject(409, "MIXED_GROUP");
    return snapshot.data();
  };

  router.post("/:groupId/attendance", route(async (req) => {
    const { matchId, memberId, action } = req.body || {};
    if (!validId(matchId) || !validId(memberId) || !["attending", "not_attending"].includes(action)) reject(400, "INVALID_ATTENDANCE");
    const groupId = req.params.groupId;
    const result = await inGroup(groupId, async (transaction) => {
      const matchRef = db.collection("matches").doc(matchId);
      const attendanceRef = matchRef.collection("attendance").doc(memberId);
      const notAttendanceRef = matchRef.collection("not_attending").doc(memberId);
      const [matchSnap, memberSnap, attendance, notAttendance] = await transaction.getAll(
        matchRef, db.collection("members").doc(memberId), attendanceRef, notAttendanceRef
      );
      const match = checkRecord(matchSnap, groupId);
      const member = checkRecord(memberSnap, groupId);
      if (match.status !== "PENDING") reject(409, "MATCH_NOT_PENDING");
      if ((action === "attending" && attendance.exists) || (action === "not_attending" && notAttendance.exists)) return { skipped: true, actions: [] };
      const memberName = member.name || "Một thành viên";
      const userAgent = req.get("User-Agent") || "";
      const record = { timestamp: Timestamp.now(), memberName, userAgent };
      transaction.set(action === "attending" ? attendanceRef : notAttendanceRef, record);
      transaction.delete(action === "attending" ? notAttendanceRef : attendanceRef);
      const logType = action === "attending" ? "ATTEND" : attendance.exists ? "CANCEL_ATTEND" : "NOT_ATTEND";
      transaction.set(matchRef.collection("attendanceLog").doc(), {
        memberId, memberName, userAgent, timestamp: FieldValue.serverTimestamp(), type: logType,
      });
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
  return router;
}

module.exports = { createPublicRouter };
