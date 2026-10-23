const { isValidGroupId, publicUrlFor, groupKindOf } = require("./groups");

/**
 * Calculates next date for a target day of the week (0=Sun, 1=Mon, ..., 6=Sat) and time (HH:mm)
 * in UTC+7 (Vietnam Time).
 */
function computeNextDateForDayOfWeek(targetDayOfWeek, timeStr = "19:00", fromDate = new Date()) {
  const [hours, minutes] = timeStr.split(":").map((v) => parseInt(v, 10) || 0);
  const vnOffsetMs = 7 * 60 * 60 * 1000;
  const vnDate = new Date(fromDate.getTime() + vnOffsetMs);

  const currentDay = vnDate.getUTCDay();
  let daysAhead = (targetDayOfWeek - currentDay + 7) % 7;
  if (daysAhead === 0) {
    const currentHour = vnDate.getUTCHours();
    const currentMin = vnDate.getUTCMinutes();
    if (currentHour > hours || (currentHour === hours && currentMin >= minutes)) {
      daysAhead = 7;
    }
  }

  const targetVn = new Date(vnDate.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const year = targetVn.getUTCFullYear();
  const month = targetVn.getUTCMonth();
  const date = targetVn.getUTCDate();

  // Create UTC date that represents UTC+7 target
  return new Date(Date.UTC(year, month, date, hours - 7, minutes, 0, 0));
}

async function createMatchFromTemplate({ db, FieldValue, groupId, templateId, creatorUid = "system", matchDate = null }) {
  if (!isValidGroupId(groupId)) throw new Error("INVALID_GROUP");

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists || groupSnap.data().status === "deleted") throw new Error("GROUP_NOT_FOUND");
  const groupData = groupSnap.data();
  if (groupKindOf(groupData) !== "sports") throw new Error("SPORTS_NOT_SUPPORTED");

  let templateData = {
    name: "Trận đấu định kỳ",
    venueName: "Sân định kỳ",
    totalAmount: 0,
    expenseItems: [{ id: "default", description: "Tiền sân", amount: 0, exemptMemberIds: [], type: "SHARED" }],
    teamCount: groupData.sport === "badminton" ? 1 : 2,
    attendanceCloseHours: 12,
    sufficientPlayerCount: groupData.sport === "badminton" ? null : 14,
    kickoffTime: "19:00",
  };

  if (templateId) {
    const tSnap = await db.collection("groups").doc(groupId).collection("templates").doc(templateId).get();
    if (tSnap.exists) {
      templateData = { ...templateData, ...tSnap.data() };
    }
  }

  const dateToUse = matchDate || computeNextDateForDayOfWeek(
    4, // default Thursday
    templateData.kickoffTime || "19:00"
  );

  const matchRef = db.collection("matches").doc();
  const matchId = matchRef.id;

  const totalAmount = Array.isArray(templateData.expenseItems)
    ? templateData.expenseItems.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
    : (Number(templateData.totalAmount) || 0);

  const newMatch = {
    groupId,
    date: dateToUse,
    totalAmount,
    expenseItems: templateData.expenseItems || [],
    teamCount: templateData.teamCount || 2,
    status: "PENDING",
    payoutStatus: "COLLECTING",
    isTest: false,
    venueName: templateData.venueName || null,
    mapIframe: templateData.mapIframe || null,
    attendanceCloseHours: templateData.attendanceCloseHours ?? 12,
    sufficientPlayerCount: templateData.sufficientPlayerCount || null,
    paidByMemberId: templateData.paidByMemberId || null,
    skipAutoAttendance: false,
    createdAt: FieldValue.serverTimestamp(),
    createdSource: "automated_schedule",
    createdBy: creatorUid,
    teamsConfig: (templateData.teamsConfig || [
      { id: "A", name: "Đội A", percent: 50, members: [] },
      { id: "B", name: "Đội B", percent: 50, members: [] },
    ]),
  };

  await matchRef.set(newMatch);

  // Auto-attend active members configured for autoAttendance
  const autoMembersSnap = await db.collection("members")
    .where("groupId", "==", groupId)
    .where("autoAttendance", "==", true)
    .get();

  if (!autoMembersSnap.empty) {
    const batch = db.batch();
    const attCol = matchRef.collection("attendance");
    autoMembersSnap.docs.forEach((doc) => {
      const m = doc.data();
      if (!m.inactive) {
        batch.set(attCol.doc(doc.id), {
          timestamp: FieldValue.serverTimestamp(),
          memberName: m.name || "Không rõ",
          userAgent: "Auto Scheduled (System)",
        }, { merge: true });
      }
    });
    await batch.commit();
  }

  return { matchId, date: dateToUse, matchData: newMatch };
}

async function checkAndRunScheduledMatches({ db, FieldValue, slack = null, targets = null, now = new Date() }) {
  const vnOffsetMs = 7 * 60 * 60 * 1000;
  const vnDate = new Date(now.getTime() + vnOffsetMs);
  const currentDayOfWeek = vnDate.getUTCDay();
  const currentHour = vnDate.getUTCHours();
  const todayStr = vnDate.toISOString().slice(0, 10);

  const results = [];
  const groupsSnap = await db.collection("groups").where("status", "==", "active").get();

  for (const groupDoc of groupsSnap.docs) {
    if (groupKindOf(groupDoc.data()) !== "sports") continue;
    const groupId = groupDoc.id;
    const schedulesToRun = [];

    // 1. Check legacy settings/schedule
    const scheduleSnap = await db.collection("groups").doc(groupId).collection("settings").doc("schedule").get();
    if (scheduleSnap.exists && scheduleSnap.data().enabled) {
      schedulesToRun.push({
        ref: scheduleSnap.ref,
        ...scheduleSnap.data(),
        templateId: scheduleSnap.data().templateId || null,
        isTemplateSchedule: false,
      });
    }

    // 2. Check templates with embedded schedule
    const templatesSnap = await db.collection("groups").doc(groupId).collection("templates").get();
    templatesSnap.docs.forEach((tDoc) => {
      const tData = tDoc.data();
      if (tData.schedule?.enabled) {
        schedulesToRun.push({
          ref: tDoc.ref,
          ...tData.schedule,
          templateId: tDoc.id,
          lastTriggeredDate: tData.schedule.lastTriggeredDate,
          isTemplateSchedule: true,
        });
      }
    });

    for (const schedule of schedulesToRun) {
      const scheduledDay = Number(schedule.dayOfWeek);
      const scheduledHour = Number(schedule.createHour ?? 9);

      if (currentDayOfWeek === scheduledDay && currentHour >= scheduledHour) {
        if (schedule.lastTriggeredDate === todayStr) {
          continue; // Already executed today
        }

        try {
          const matchDayOfWeek = schedule.matchDayOfWeek !== undefined ? Number(schedule.matchDayOfWeek) : ((scheduledDay + 2) % 7);
          const matchTime = schedule.matchTime || "19:00";
          const scheduledDate = computeNextDateForDayOfWeek(matchDayOfWeek, matchTime, now);

          const result = await createMatchFromTemplate({
            db,
            FieldValue,
            groupId,
            templateId: schedule.templateId || null,
            creatorUid: "cron_scheduler",
            matchDate: scheduledDate,
          });

          if (schedule.isTemplateSchedule) {
            await schedule.ref.update({
              "schedule.lastTriggeredDate": todayStr,
              "schedule.lastCreatedMatchId": result.matchId,
              "schedule.lastTriggeredAt": FieldValue.serverTimestamp(),
            });
          } else {
            await schedule.ref.update({
              lastTriggeredDate: todayStr,
              lastCreatedMatchId: result.matchId,
              lastTriggeredAt: FieldValue.serverTimestamp(),
            });
          }

          if (slack && targets) {
            try {
              const target = await targets.getSlackTarget(groupId);
              if (target) {
                const webBaseUrl = slack.PUBLIC_WEB_URL || "https://thienbun-payment.web.app";
                await slack.sendBlock({
                  headerText: "⚽ Đã mở điểm danh trận mới (Tự động)",
                  bodyMarkdown: `<!here>\n📅 Trận *${slack.formatMatchDate ? slack.formatMatchDate(result.date) : result.date.toISOString().slice(0, 10)}*${result.matchData.venueName ? `\n📍 ${result.matchData.venueName}` : ""}\n\n🏃 Hệ thống đã tự động tạo trận và mở điểm danh!`,
                  cta: {
                    label: "Điểm danh ngay",
                    url: `${publicUrlFor(groupId, webBaseUrl)}/attendance`,
                    style: "primary",
                  },
                  fallbackText: "Đã mở điểm danh trận mới",
                }, target);
              }
            } catch (slackErr) {
              console.error(`[scheduledMatches] Slack notification failed for group ${groupId}`, slackErr);
            }
          }

          results.push({ groupId, success: true, matchId: result.matchId });
        } catch (err) {
          results.push({ groupId, success: false, error: err.message });
        }
      }
    }
  }

  return results;
}

module.exports = {
  computeNextDateForDayOfWeek,
  createMatchFromTemplate,
  checkAndRunScheduledMatches,
};
