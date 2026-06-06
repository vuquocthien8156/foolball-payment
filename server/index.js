// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PayOS } = require("@payos/node");
const admin = require("firebase-admin");
const axios = require("axios");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const slack = require("./lib/slack");
const cfg = require("./lib/slackConfig");

// --- Firebase Admin SDK Initialization ---
// Ensure you have the service account key file in the `server` directory
// The SDK will automatically discover the service account credentials from
// the environment when deployed. For local development, set the
// GOOGLE_APPLICATION_CREDENTIALS environment variable.
admin.initializeApp();
console.log("Firebase Admin SDK initialized successfully.");

// --- PayOS Initialization ---
const payos = new PayOS(
  process.env.PAYOS_CLIENT_ID,
  process.env.PAYOS_API_KEY,
  process.env.PAYOS_CHECKSUM_KEY
);

const app = express();
const port = process.env.PORT || 3001;

// --- Middlewares ---
app.use(cors()); // Configure this properly for production
app.use(express.json());

// --- Routes ---

const apiRoutes = express.Router();

const FieldValue = admin.firestore.FieldValue;

const chunkArray = (arr, size) =>
  arr.reduce((acc, _, idx) => {
    if (idx % size === 0) acc.push(arr.slice(idx, idx + size));
    return acc;
  }, []);

const collectAllTokens = async () => {
  const db = admin.firestore();
  const tokens = new Set();

  const tokenSnap = await db.collection("notificationTokens").get();
  tokenSnap.forEach((doc) => {
    const data = doc.data();
    const token = data.token || doc.id;
    if (token) tokens.add(token);
  });

  const membersSnap = await db.collection("members").get();
  membersSnap.forEach((doc) => {
    const data = doc.data();
    if (data.fcmToken) tokens.add(data.fcmToken);
  });

  return Array.from(tokens);
};

const cleanUpInvalidTokens = async (invalidTokens = []) => {
  if (invalidTokens.length === 0) return;
  const db = admin.firestore();
  const batch = db.batch();
  invalidTokens.forEach((token) => {
    batch.delete(db.collection("notificationTokens").doc(token));
  });

  for (const chunk of chunkArray(invalidTokens, 10)) {
    const snap = await db
      .collection("members")
      .where("fcmToken", "in", chunk)
      .get();
    snap.forEach((doc) => {
      batch.update(doc.ref, {
        fcmToken: null,
        fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  await batch.commit();
};

const sendPushToTokens = async (tokens, payload) => {
  const messaging = admin.messaging();
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  for (const chunk of chunkArray(tokens, 500)) {
    const response = await messaging.sendEachForMulticast({
      tokens: chunk,
      ...payload,
    });
    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code || "";
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.push(chunk[idx]);
        }
      }
    });
  }

  if (invalidTokens.length > 0) {
    await cleanUpInvalidTokens(invalidTokens);
  }

  return { successCount, failureCount, invalidTokens: invalidTokens.length };
};

apiRoutes.post("/create-payment-link", async (req, res) => {
  const { shareIds, memberId, ratings } = req.body;

  if (
    !shareIds ||
    !Array.isArray(shareIds) ||
    shareIds.length === 0 ||
    !memberId
  ) {
    return res
      .status(400)
      .json({ error: "shareIds (non-empty array) and memberId are required" });
  }

  try {
    const db = admin.firestore();
    const sharesRef = db.collectionGroup("shares");
    const querySnapshot = await sharesRef
      .where("memberId", "==", memberId)
      .where("status", "==", "PENDING")
      .get();

    const selectedShareDocs = querySnapshot.docs.filter((doc) =>
      shareIds.includes(doc.id)
    );

    if (selectedShareDocs.length === 0) {
      return res.status(404).json({
        error: "No matching pending shares found for the provided IDs",
      });
    }

    let totalAmount = 0;
    const fetchedShareIds = [];
    selectedShareDocs.forEach((doc) => {
      const shareData = doc.data();
      if (shareData.memberId !== memberId) {
        throw new Error(
          `Share ${doc.id} does not belong to member ${memberId}`
        );
      }
      if (shareData.status !== "PENDING") {
        throw new Error(`Share ${doc.id} is not in PENDING state.`);
      }
      totalAmount += shareData.amount;
      fetchedShareIds.push(doc.id);
    });

    if (totalAmount <= 0) {
      return res
        .status(400)
        .json({ error: "Total amount must be greater than zero." });
    }

    const orderCode = Date.now();

    // Fetch member name
    const memberDoc = await db.collection("members").doc(memberId).get();
    const memberName = memberDoc.exists ? memberDoc.data().name : "";

    // Remove Vietnamese diacritics for payment description
    const removeDiacritics = (str) => {
      return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
    };
    const cleanName = removeDiacritics(memberName)
      .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special characters
      .replace(/\s+/g, " ")
      .trim();

    // Get first name only (last word in Vietnamese names is usually first name)
    const nameParts = cleanName.split(" ");
    const firstName = nameParts[nameParts.length - 1] || cleanName;

    // Short code (last 6 digits of timestamp)
    const shortCode = String(orderCode).slice(-6);

    // PayOS description max 25 chars: "{firstName} gui {shortCode}"
    // Truncate firstName if needed (max 12 chars to leave room)
    const shortName = firstName.slice(0, 12);
    const description = shortName
      ? `${shortName} gui ${shortCode}`
      : `TienBanh ${shortCode}`;

    // Create a payment request document to store context
    const paymentRequestRef = db
      .collection("paymentRequests")
      .doc(String(orderCode));
    await paymentRequestRef.set({
      orderCode,
      shareIds: fetchedShareIds,
      memberId,
      ratings: ratings || null, // Store ratings, can be null
      status: "PENDING",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Use a batch to update all selected shares with the same orderCode
    const batch = db.batch();
    selectedShareDocs.forEach((doc) => {
      batch.update(doc.ref, { payosOrderCode: orderCode });
    });
    await batch.commit();

    const paymentData = {
      orderCode,
      amount: totalAmount,
      description,
      returnUrl: process.env.PAYOS_RETURN_URL,
      cancelUrl: process.env.PAYOS_CANCEL_URL,
    };

    const paymentLink = await payos.paymentRequests.create(paymentData);

    // Return the entire payment link object for the embedded checkout
    res.json(paymentLink);
  } catch (error) {
    console.error("Error creating payment link:", error);
    res
      .status(500)
      .json({ error: "Failed to create payment link", details: error.message });
  }
});

const payosWebhookHandler = async (req, res) => {
  try {
    const webhookData = await payos.webhooks.verify(req.body);
    console.log("Webhook verified successfully:", webhookData);

    // More reliable: only check for the success code. The description text can change.
    if (webhookData.code === "00") {
      const orderCode = webhookData.orderCode;
      const db = admin.firestore();

      // Capture payment context for post-transaction Slack notifications.
      let paidContext = null; // { memberName, totalPaid, affectedMatchIds: Set<string> }

      // Start a transaction to ensure atomicity
      await db.runTransaction(async (transaction) => {
        // 1. Get the payment request to access ratings and shareIds
        const paymentRequestRef = db
          .collection("paymentRequests")
          .doc(String(orderCode));
        const paymentRequestSnap = await transaction.get(paymentRequestRef);

        if (!paymentRequestSnap.exists) {
          console.error(
            `Webhook: No payment request found for orderCode ${orderCode}`
          );
          // Don't throw, just log and exit, as PayOS might retry.
          return;
        }
        const paymentRequestData = paymentRequestSnap.data();

        // 2. Get the related share documents
        const sharesQuery = db
          .collectionGroup("shares")
          .where("payosOrderCode", "==", orderCode);
        const sharesSnapshot = await sharesQuery.get();

        if (sharesSnapshot.empty) {
          console.error(`Webhook: No shares found for orderCode ${orderCode}`);
          return;
        }

        // 3. Process ratings if they exist
        if (
          paymentRequestData.ratings &&
          Array.isArray(paymentRequestData.ratings)
        ) {
          for (const rating of paymentRequestData.ratings) {
            const { matchId, ratedByMemberId, playerRatings, mvpPlayerId } =
              rating;
            if (matchId && ratedByMemberId && playerRatings && mvpPlayerId) {
              const ratingRef = db
                .collection("matches")
                .doc(matchId)
                .collection("ratings")
                .doc();
              transaction.set(ratingRef, {
                ratedByMemberId,
                playerRatings,
                mvpPlayerId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                orderCode, // Link back to the payment
              });
            }
          }
        }

        // 4. Update share statuses and create notifications
        const memberId = paymentRequestData.memberId;
        const memberDoc = await db.collection("members").doc(memberId).get();
        const memberName = memberDoc.exists
          ? memberDoc.data().name
          : "Một thành viên";

        let totalPaid = 0;
        const affectedMatchIds = new Set();

        sharesSnapshot.docs.forEach((doc) => {
          const shareData = doc.data();
          if (shareData.status !== "PAID") {
            transaction.update(doc.ref, {
              status: "PAID",
              paidAt: new Date().toISOString(),
              channel: "PAYOS",
              meta: { webhook: webhookData },
            });

            const notificationRef = db.collection("notifications").doc();
            const matchId = shareData.matchId;
            if (!matchId) {
              console.error(`CRITICAL: matchId is missing in share ${doc.id}`);
              return;
            }
            transaction.set(notificationRef, {
              message: `${memberName} đã thanh toán ${shareData.amount.toLocaleString()} VND`,
              matchId: matchId,
              shareId: doc.id,
              isRead: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            totalPaid += shareData.amount || 0;
            affectedMatchIds.add(matchId);
          }
        });

        // 5. Update the payment request status
        transaction.update(paymentRequestRef, {
          status: "PAID",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        paidContext = { memberName, totalPaid, affectedMatchIds };
      });

      console.log(
        `Successfully processed payment and ratings for orderCode: ${orderCode}`
      );

      // Post-transaction: fire Slack notifications.
      if (paidContext && paidContext.totalPaid > 0) {
        // C1 — single message summarising this payment.
        const matchIdsArr = Array.from(paidContext.affectedMatchIds);
        // Compute remaining for each affected match in parallel
        const matchSummaries = await Promise.all(
          matchIdsArr.map(async (mId) => {
            const matchSnap = await db.collection("matches").doc(mId).get();
            const sharesSnap = await db
              .collection("matches")
              .doc(mId)
              .collection("shares")
              .get();
            let pendingCount = 0;
            let pendingAmount = 0;
            let totalCount = 0;
            sharesSnap.forEach((s) => {
              const d = s.data();
              totalCount += 1;
              if (d.status === "PENDING") {
                pendingCount += 1;
                pendingAmount += d.amount || 0;
              }
            });
            return {
              matchId: mId,
              matchData: matchSnap.exists ? matchSnap.data() : null,
              pendingCount,
              pendingAmount,
              totalCount,
              fullyPaid: totalCount > 0 && pendingCount === 0,
            };
          })
        );

        const c1Lines = matchSummaries.map((s) => {
          const dateLabel = slack.formatMatchDate(s.matchData?.date);
          if (s.fullyPaid) {
            return `🎉 📅 *${dateLabel}*: đã thu đủ ✅`;
          }
          return `📅 *${dateLabel}*: còn ${s.pendingCount}/${
            s.totalCount
          } chưa trả (💰 *${slack.formatVnd(s.pendingAmount)} VND*)`;
        });

        slack
          .sendBlock({
            headerText: "💵 Có người vừa thanh toán",
            bodyMarkdown: `👤 *${paidContext.memberName}* đã trả 💰 *${slack.formatVnd(
              paidContext.totalPaid
            )} VND*\n\n${c1Lines.join("\n")}`,
            fallbackText: `${paidContext.memberName} đã trả ${slack.formatVnd(
              paidContext.totalPaid
            )} VND`,
          })
          .catch((e) => console.error("[slack] C1 failed", e));

        // C2 — for each match that just became fully paid.
        for (const s of matchSummaries) {
          if (!s.fullyPaid) continue;
          const matchTotal = s.matchData?.totalAmount || 0;
          slack
            .sendBlock({
              headerText: "🎉 Trận đã thu đủ tiền!",
              bodyMarkdown: `📅 *${slack.formatMatchDate(s.matchData?.date)}*${
                s.matchData?.venueName ? `\n📍 ${s.matchData.venueName}` : ""
              }\n\n💰 Tổng thu: *${slack.formatVnd(matchTotal)} VND*\n👥 ${
                s.totalCount
              } người\n\n🎊 Cảm ơn cả đội đã thanh toán đầy đủ!`,
              fallbackText: `Trận ${slack.formatMatchDate(
                s.matchData?.date
              )} đã thu đủ`,
            })
            .catch((e) => console.error("[slack] C2 failed", e));
        }
      }
    } else {
      console.log("Webhook received for non-successful payment:", webhookData);
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res
      .status(500)
      .json({ error: "Webhook processing failed", details: error.message });
  }
};

apiRoutes.get("/payos-webhook", (req, res) => {
  res.status(200).send("Webhook URL is active and ready to receive data.");
});
apiRoutes.post("/payos-webhook", payosWebhookHandler);
apiRoutes.put("/payos-webhook", payosWebhookHandler);

apiRoutes.post("/send-match-notification", async (req, res) => {
  const { matchId } = req.body;

  if (!matchId) {
    return res.status(400).json({ error: "matchId is required" });
  }

  try {
    const db = admin.firestore();
    const matchDoc = await db.collection("matches").doc(matchId).get();
    if (!matchDoc.exists) {
      return res.status(404).json({ error: "Match not found" });
    }

    const matchData = matchDoc.data();
    const rostersSnapshot = await db
      .collection("matches")
      .doc(matchId)
      .collection("rosters")
      .get();
    if (rostersSnapshot.empty) {
      return res.status(200).json({ message: "No rosters for this match." });
    }

    const memberIds = new Set();
    rostersSnapshot.forEach((rosterDoc) => {
      const rosterData = rosterDoc.data();
      if (rosterData.memberIds && Array.isArray(rosterData.memberIds)) {
        rosterData.memberIds.forEach((id) => memberIds.add(id));
      }
    });

    if (memberIds.size === 0) {
      return res.status(200).json({ message: "No members found in rosters." });
    }

    const uniqueMemberIds = Array.from(memberIds);
    const membersSnapshot = await db
      .collection("members")
      .where(admin.firestore.FieldPath.documentId(), "in", uniqueMemberIds)
      .get();

    const tokens = [];
    membersSnapshot.forEach((memberDoc) => {
      const memberData = memberDoc.data();
      if (memberData.fcmToken) {
        tokens.push(memberData.fcmToken);
      }
    });

    if (tokens.length === 0) {
      return res
        .status(200)
        .json({ message: "No members have subscribed to notifications." });
    }

    const dateObj = matchData.date;
    let formattedDate = "Không rõ";
    if (dateObj && typeof dateObj.toDate === "function") {
      formattedDate = dateObj.toDate().toLocaleDateString("vi-VN");
    }

    const message = {
      notification: {
        title: "Có hóa đơn trận đấu mới!",
        body: `Bạn có một hóa đơn mới cho trận đấu ngày ${formattedDate}. Mở ứng dụng để thanh toán ngay.`,
      },
      tokens: tokens,
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log("Successfully sent message:", response);
    res.status(200).json({
      success: true,
      message: `Notification sent to ${response.successCount} devices.`,
    });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

apiRoutes.post("/notify/attendance-created", async (req, res) => {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: "matchId is required" });
  }

  try {
    const db = admin.firestore();
    const matchSnap = await db.collection("matches").doc(matchId).get();
    if (!matchSnap.exists) {
      return res.status(404).json({ error: "Match not found" });
    }
    const match = matchSnap.data();
    const dateLabel =
      match.date?.toDate?.().toLocaleDateString("vi-VN") || "trận mới";

    // --- Auto Attendance Logic ---
    // Skip when match.skipAutoAttendance === true.
    let autoAttendedNames = [];
    if (match.skipAutoAttendance) {
      console.log(`Skipping auto-attendance for match ${matchId} (admin opted out)`);
    } else {
      const autoMembersQuery = db
        .collection("members")
        .where("autoAttendance", "==", true);
      const autoMembersSnap = await autoMembersQuery.get();

      if (!autoMembersSnap.empty) {
        const batch = db.batch();
        const attendanceCollectionRef = db
          .collection("matches")
          .doc(matchId)
          .collection("attendance");

        autoMembersSnap.forEach((doc) => {
          const memberData = doc.data();
          if (memberData.inactive) return;
          autoAttendedNames.push(memberData.name || "Không rõ");
          const attendanceRef = attendanceCollectionRef.doc(doc.id);
          batch.set(
            attendanceRef,
            {
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              memberName: memberData.name,
              userAgent: "Auto Attendance (System)",
            },
            { merge: true }
          );
        });

        await batch.commit();
        console.log(
          `Auto-attended ${autoAttendedNames.length} members for match ${matchId}`
        );
      }
    }
    // -----------------------------

    const tokens = await collectAllTokens();
    if (tokens.length === 0) {
      return res.status(200).json({ message: "No subscribers" });
    }

    const result = await sendPushToTokens(tokens, {
      notification: {
        title: "Đã mở điểm danh!",
        body: `Trận ngày ${dateLabel} đã mở điểm danh. Vào ứng dụng để xác nhận.`,
      },
      data: {
        matchId,
        type: "attendance_created",
      },
    });

    // Slack: A1 — open attendance
    const autoAttendSection =
      autoAttendedNames.length > 0
        ? `\n\n✅ *Đã tự động điểm danh ${autoAttendedNames.length} người:*\n${autoAttendedNames
            .map((n) => `   👤 ${n}`)
            .join("\n")}`
        : match.skipAutoAttendance
          ? "\n\n🚫 _Trận này tắt auto — mọi người tự điểm danh nhé!_"
          : "";

    slack
      .sendBlock({
        headerText: "⚽ Đã mở điểm danh trận mới",
        bodyMarkdown: `📅 *${slack.formatMatchDate(match.date)}*${
          match.venueName ? `\n📍 ${match.venueName}` : ""
        }${autoAttendSection}`,
        fields: [
          ...(match.totalAmount
            ? [
                {
                  title: "💰 Tổng tiền dự kiến",
                  value: `${slack.formatVnd(match.totalAmount)} VND`,
                },
              ]
            : []),
          ...(match.attendanceCloseHours
            ? [
                {
                  title: "⏱️ Giờ đóng cổng",
                  value: `${match.attendanceCloseHours}h trước ngày đá`,
                },
              ]
            : []),
        ],
        cta: {
          label: "Điểm danh ngay",
          url: `${slack.PUBLIC_WEB_URL}/attendance`,
          style: "primary",
        },
        fallbackText: `Trận mới ${dateLabel} đã mở điểm danh`,
      })
      .catch((e) => console.error("[slack] A1 failed", e));

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("Error sending attendance-created notification:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

apiRoutes.post("/notify/attendance-deleted", async (req, res) => {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: "matchId is required" });
  }
  try {
    const db = admin.firestore();
    const matchSnap = await db.collection("matches").doc(matchId).get();
    const match = matchSnap.exists ? matchSnap.data() : null;
    const dateLabel =
      match?.date?.toDate?.().toLocaleDateString("vi-VN") || "trận điểm danh";

    const tokens = await collectAllTokens();
    if (tokens.length === 0) {
      return res.status(200).json({ message: "No subscribers" });
    }
    const result = await sendPushToTokens(tokens, {
      notification: {
        title: "Trận điểm danh đã hủy",
        body: `Điểm danh trận ${dateLabel} đã bị hủy. Vui lòng chờ thông báo mới.`,
      },
      data: {
        matchId,
        type: "attendance_deleted",
      },
    });

    // Slack: A2 — attendance deleted
    slack
      .sendBlock({
        headerText: "❌ Đã hủy trận điểm danh",
        bodyMarkdown: `📅 Trận *${slack.formatMatchDate(match?.date)}* đã bị hủy.${
          match?.venueName ? `\n📍 ${match.venueName}` : ""
        }\n\n😢 Hẹn anh em trận sau nhé!`,
        fallbackText: `Trận ${dateLabel} đã hủy điểm danh`,
      })
      .catch((e) => console.error("[slack] A2 failed", e));

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("Error sending attendance-deleted notification:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

apiRoutes.post("/notify/member-action", async (req, res) => {
  const { matchId, memberId, memberName, action } = req.body;
  if (!matchId || !memberId || !action) {
    return res
      .status(400)
      .json({ error: "matchId, memberId, action are required" });
  }
  const validActions = [
    "ATTEND",
    "NOT_ATTEND",
    "CANCEL_ATTEND",
    "CANCEL_NOT_ATTEND",
  ];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  try {
    const db = admin.firestore();
    const matchSnap = await db.collection("matches").doc(matchId).get();
    const match = matchSnap.exists ? matchSnap.data() : null;

    // Resolve member name if not provided
    let resolvedName = memberName;
    if (!resolvedName) {
      const memberSnap = await db.collection("members").doc(memberId).get();
      resolvedName = memberSnap.exists ? memberSnap.data().name : "Một thành viên";
    }

    // All actions enqueue. CANCEL_ATTEND keeps cancelledAt for display.
    await db.collection("slackQueue").add({
      type: action,
      matchId,
      memberId,
      memberName: resolvedName,
      matchDateLabel: slack.formatMatchDate(match?.date),
      enqueuedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ success: true, mode: "queued" });
  } catch (error) {
    console.error("Error in /notify/member-action:", error);
    res.status(500).json({ error: "Failed to record action" });
  }
});

apiRoutes.post("/notify/match-published", async (req, res) => {
  const { matchId } = req.body;
  if (!matchId) {
    return res.status(400).json({ error: "matchId is required" });
  }
  try {
    const db = admin.firestore();
    const matchSnap = await db.collection("matches").doc(matchId).get();
    if (!matchSnap.exists) {
      return res.status(404).json({ error: "Match not found" });
    }
    const match = matchSnap.data();

    const sharesSnap = await db
      .collection("matches")
      .doc(matchId)
      .collection("shares")
      .get();
    const totalShares = sharesSnap.size;
    const totalAmount = sharesSnap.docs.reduce(
      (sum, d) => sum + (d.data().amount || 0),
      0
    );

    // Push to FCM subscribers
    const tokens = await collectAllTokens();
    let pushResult = { successCount: 0, failureCount: 0 };
    if (tokens.length > 0) {
      pushResult = await sendPushToTokens(tokens, {
        notification: {
          title: "Bill trận đã công khai!",
          body: `Bill trận ${slack.formatMatchDate(
            match.date
          )} đã công khai. Vào để thanh toán.`,
        },
        data: { matchId, type: "match_published" },
      });
    }

    // Resolve người ứng tiền sân (nếu có)
    let paidByName = null;
    if (match.paidByMemberId) {
      const memberSnap = await db
        .collection("members")
        .doc(match.paidByMemberId)
        .get();
      if (memberSnap.exists) {
        paidByName = memberSnap.data().name || null;
      }
    }

    // Slack: A6 — publish bill
    slack
      .sendBlock({
        headerText: "📢 Bill trận đã công khai",
        bodyMarkdown: `📅 *${slack.formatMatchDate(match.date)}*${
          match.venueName ? `\n📍 ${match.venueName}` : ""
        }${paidByName ? `\n💸 Người ứng tiền sân: *${paidByName}*` : ""}\n\n💳 Anh em vào thanh toán nhé!`,
        fields: [
          {
            title: "💰 Tổng tiền",
            value: `${slack.formatVnd(totalAmount)} VND`,
          },
          {
            title: "👥 Số người chia",
            value: `${totalShares} người`,
          },
        ],
        cta: {
          label: "Vào thanh toán",
          url: `${slack.PUBLIC_WEB_URL}/pay`,
          style: "primary",
        },
        fallbackText: `Bill trận ${slack.formatMatchDate(
          match.date
        )} đã công khai`,
      })
      .catch((e) => console.error("[slack] A6 failed", e));

    res.status(200).json({ success: true, ...pushResult });
  } catch (error) {
    console.error("Error sending match-published notification:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

apiRoutes.post("/notify/manual", async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: "title and body are required" });
  }
  try {
    const tokens = await collectAllTokens();
    if (tokens.length === 0) {
      return res.status(200).json({ message: "No subscribers" });
    }
    const result = await sendPushToTokens(tokens, {
      notification: {
        title,
        body,
      },
      data: { type: "manual_broadcast" },
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("Error sending manual notification:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

// =====================================================
// TEAM LOCK FLOW (Slack → Web → Lock teamsConfig)
// =====================================================

const { randomBytes } = require("crypto");
const generateToken = () => randomBytes(16).toString("hex");

apiRoutes.post("/teams/propose", async (req, res) => {
  const { matchId, teamsConfig } = req.body;
  if (
    !matchId ||
    !Array.isArray(teamsConfig) ||
    teamsConfig.length === 0
  ) {
    return res
      .status(400)
      .json({ error: "matchId and teamsConfig (non-empty array) are required" });
  }

  try {
    const db = admin.firestore();
    const matchRef = db.collection("matches").doc(matchId);
    const matchSnap = await matchRef.get();
    if (!matchSnap.exists) {
      return res.status(404).json({ error: "Match not found" });
    }
    const match = matchSnap.data();

    // Token expires when attendance gate closes — sau giờ đó đội hình không còn ý nghĩa.
    const closeHours =
      typeof match.attendanceCloseHours === "number"
        ? match.attendanceCloseHours
        : cfg.DEFAULT_ATTENDANCE_CLOSE_HOURS;
    let expiresAt = null;
    if (match.date?.toDate) {
      const matchDate = match.date.toDate();
      const matchDayStart = new Date(matchDate);
      matchDayStart.setHours(0, 0, 0, 0);
      expiresAt = new Date(
        matchDayStart.getTime() - closeHours * 60 * 60 * 1000
      );
    }

    const token = generateToken();

    // Sanitize teamsConfig — only keep fields we care about, nest nulls instead of undefined.
    const cleanTeams = teamsConfig.map((t) => ({
      id: String(t.id || ""),
      name: String(t.name || ""),
      members: Array.isArray(t.members)
        ? t.members.map((m) => ({
            id: String(m.id || ""),
            name: String(m.name || ""),
          }))
        : [],
    }));

    await matchRef.update({
      proposedTeam: {
        token,
        teamsConfig: cleanTeams,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: expiresAt
          ? admin.firestore.Timestamp.fromDate(expiresAt)
          : null,
      },
    });

    // Build Slack message with team breakdown.
    const lines = cleanTeams
      .filter((t) => t.members.length > 0)
      .map((t, idx) => {
        const teamIcon = idx === 0 ? "🔵" : idx === 1 ? "🔴" : "🟡";
        const names = t.members.map((m) => `   👤 ${m.name}`).join("\n");
        return `${teamIcon} *${t.name}* (${t.members.length}):\n${names}`;
      });

    const lockUrl = `${slack.PUBLIC_WEB_URL}/public/team-locked?token=${token}&matchId=${matchId}`;

    slack
      .sendBlock({
        headerText: "🏃 Đội hình đề xuất",
        bodyMarkdown: `📅 Trận *${slack.formatMatchDate(match.date)}*${
          match.venueName ? `\n📍 ${match.venueName}` : ""
        }\n\n${lines.join("\n\n")}${
          expiresAt
            ? `\n\n⏳ _Token hết hạn lúc: ${slack.formatTimestamp(expiresAt)}_`
            : ""
        }\n\n👇 Bấm nút bên dưới để chốt đội hình:`,
        cta: {
          label: "Chốt đội hình",
          url: lockUrl,
          style: "primary",
        },
        fallbackText: "Đội hình đề xuất",
      })
      .catch((e) => console.error("[slack] team-propose failed", e));

    res.status(200).json({ success: true, token });
  } catch (error) {
    console.error("Error in /teams/propose:", error);
    res.status(500).json({ error: "Failed to propose teams" });
  }
});

apiRoutes.post("/teams/lock", async (req, res) => {
  const { matchId, token } = req.body;
  if (!matchId || !token) {
    return res.status(400).json({ error: "matchId and token are required" });
  }

  try {
    const db = admin.firestore();
    const matchRef = db.collection("matches").doc(matchId);

    const result = await db.runTransaction(async (txn) => {
      const matchSnap = await txn.get(matchRef);
      if (!matchSnap.exists) {
        return { ok: false, reason: "Match not found", code: 404 };
      }
      const match = matchSnap.data();
      const proposed = match.proposedTeam;

      if (!proposed) {
        // Could be already locked.
        if (match.lockedTeam) {
          return {
            ok: false,
            reason: "Đội hình đã được chốt trước đó",
            code: 409,
            already: match.lockedTeam,
          };
        }
        return { ok: false, reason: "Không có đề xuất đội hình", code: 404 };
      }

      if (proposed.token !== token) {
        // Token mismatch — likely a stale link from an older proposal.
        return {
          ok: false,
          reason:
            "Link đã bị thay thế bởi đề xuất mới. Vui lòng dùng link Slack mới nhất.",
          code: 410,
        };
      }

      // Expiry check.
      const now = new Date();
      const expiresAt = proposed.expiresAt?.toDate?.();
      if (expiresAt && now > expiresAt) {
        return {
          ok: false,
          reason: "Token đã hết hạn",
          code: 410,
        };
      }

      // Build new teamsConfig that preserves existing per-team percent + per-member overrides
      // when matchable; otherwise default to even split.
      const existingTeams = Array.isArray(match.teamsConfig)
        ? match.teamsConfig
        : [];
      const existingByTeamId = new Map(
        existingTeams.map((t) => [t.id, t])
      );

      const proposedTeams = proposed.teamsConfig || [];
      const teamCount = proposedTeams.length || 2;
      const evenPercent = Math.floor(100 / teamCount);

      const merged = proposedTeams.map((pt, idx) => {
        const ex = existingByTeamId.get(pt.id);
        const exMembersById = new Map(
          (ex?.members || []).map((m) => [m.id, m])
        );
        return {
          id: pt.id,
          name: pt.name || ex?.name || `Đội ${idx + 1}`,
          percent:
            typeof ex?.percent === "number" ? ex.percent : evenPercent,
          members: pt.members.map((pm) => {
            const exM = exMembersById.get(pm.id);
            return {
              id: pm.id,
              percent: exM?.percent ?? null,
              reason: exM?.reason ?? null,
            };
          }),
        };
      });

      const lockedTeam = {
        teamsConfig: merged,
        lockedAt: admin.firestore.Timestamp.now(),
        userAgent: req.get("user-agent") || "Unknown",
        ip:
          req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req.ip ||
          "Unknown",
      };

      txn.update(matchRef, {
        teamsConfig: merged,
        lockedTeam,
        proposedTeam: admin.firestore.FieldValue.delete(),
      });

      return { ok: true, lockedTeam, matchData: match };
    });

    if (!result.ok) {
      return res
        .status(result.code || 400)
        .json({ error: result.reason, already: result.already });
    }

    // Post-transaction: bắn Slack confirmation.
    const matchSnapAfter = await matchRef.get();
    const matchAfter = matchSnapAfter.data();
    const teamSummary = (matchAfter.teamsConfig || [])
      .filter((t) => (t.members || []).length > 0)
      .map((t) => `*${t.name}* (${(t.members || []).length})`)
      .join(" · ");

    slack
      .sendBlock({
        headerText: "✅ Đội hình đã được chốt",
        bodyMarkdown: `📅 Trận *${slack.formatMatchDate(matchAfter.date)}*${
          matchAfter.venueName ? `\n📍 ${matchAfter.venueName}` : ""
        }\n\n🏁 ${teamSummary}\n\n🕐 _Chốt lúc ${slack.formatTimestamp(
          result.lockedTeam.lockedAt
        )}_`,
        fallbackText: "Đội hình đã được chốt",
      })
      .catch((e) => console.error("[slack] team-locked failed", e));

    res.status(200).json({ success: true, lockedTeam: result.lockedTeam });
  } catch (error) {
    console.error("Error in /teams/lock:", error);
    res.status(500).json({ error: "Failed to lock teams" });
  }
});

// Mount the API router under the /api prefix
app.use("/api", apiRoutes);

// --- Start Server ---
// app.listen(port, () => {
//   console.log(`Server is listening on port ${port}`);
// });

// Export the Express API as a Cloud Function
exports.api = onRequest({ invoker: "public" }, app);

// =====================================================
// SCHEDULED CRON JOBS
// =====================================================

const TZ = cfg.TIMEZONE;

const computeClosingTime = (matchDate, closeHours) => {
  if (!matchDate) return null;
  const d =
    typeof matchDate.toDate === "function" ? matchDate.toDate() : new Date(matchDate);
  if (isNaN(d.getTime())) return null;
  const hours =
    typeof closeHours === "number"
      ? closeHours
      : cfg.DEFAULT_ATTENDANCE_CLOSE_HOURS;
  const matchDayStart = new Date(d);
  matchDayStart.setHours(0, 0, 0, 0);
  return new Date(matchDayStart.getTime() - hours * 60 * 60 * 1000);
};

/**
 * A3 + A4 — fires "sắp đóng" (cảnh báo trước close) and "đã đóng" (past closingTime).
 * Each fires at most once per match (idempotent flags on match doc).
 */
exports.checkAttendanceClose = onSchedule(
  {
    schedule: `every ${cfg.ATTENDANCE_CHECK_MINUTES} minutes`,
    timeZone: TZ,
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const warnWindowMs =
      cfg.ATTENDANCE_WARN_HOURS_BEFORE_CLOSE * 60 * 60 * 1000;

    const pendingSnap = await db
      .collection("matches")
      .where("status", "==", "PENDING")
      .get();

    for (const docSnap of pendingSnap.docs) {
      const data = docSnap.data();
      if (data.isDeleted) continue;
      const closing = computeClosingTime(data.date, data.attendanceCloseHours);
      if (!closing) continue;

      const matchId = docSnap.id;

      // A3 — sắp đóng (within 4h window before closingTime)
      if (
        !data.attendanceWarnedNotified &&
        now < closing &&
        closing - now <= warnWindowMs
      ) {
        // Count attendance
        const attSnap = await db
          .collection("matches")
          .doc(matchId)
          .collection("attendance")
          .get();
        const attCount = attSnap.size;

        // Format remaining time as "Xh Ym" or "Xm".
        const remainingMs = closing - now;
        const remainingMin = Math.round(remainingMs / 60000);
        const remainingLabel =
          remainingMin >= 60
            ? `${Math.floor(remainingMin / 60)}h${
                remainingMin % 60 > 0 ? ` ${remainingMin % 60}m` : ""
              }`
            : `${remainingMin} phút`;

        await slack
          .sendBlock({
            headerText: "⏰ Sắp đóng cổng điểm danh",
            bodyMarkdown: `📅 Trận *${slack.formatMatchDate(data.date)}*${
              data.venueName ? `\n📍 ${data.venueName}` : ""
            }\n\n🚪 Cổng đóng lúc *${slack.formatTimestamp(closing)}* — ⏳ còn *${remainingLabel}*\n👥 Hiện đã có *${attCount} người* điểm danh.\n\n🏃 Ai chưa điểm danh thì vào nhanh nhé!`,
            cta: {
              label: "Điểm danh ngay",
              url: `${slack.PUBLIC_WEB_URL}/attendance`,
              style: "primary",
            },
            fallbackText: "Sắp đóng cổng điểm danh",
          })
          .catch((e) => console.error("[slack] A3 failed", e));

        await docSnap.ref.update({
          attendanceWarnedNotified: true,
          attendanceWarnedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // A4 — đã đóng (now >= closingTime)
      if (!data.attendanceClosedNotified && now >= closing) {
        const attSnap = await db
          .collection("matches")
          .doc(matchId)
          .collection("attendance")
          .get();
        const notAttSnap = await db
          .collection("matches")
          .doc(matchId)
          .collection("not_attending")
          .get();

        const attendees = attSnap.docs.map(
          (d) => d.data().memberName || "Không rõ"
        );

        await slack
          .sendBlock({
            headerText: "🔒 Đã chốt danh sách điểm danh",
            bodyMarkdown: `📅 Trận *${slack.formatMatchDate(data.date)}*${
              data.venueName ? `\n📍 ${data.venueName}` : ""
            }\n\n👥 *${attSnap.size} người tham gia*${
              attendees.length > 0
                ? `:\n${attendees.map((n) => `   👤 ${n}`).join("\n")}`
                : ""
            }${notAttSnap.size > 0 ? `\n\n🚫 _Báo vắng: ${notAttSnap.size} người_` : ""}\n\n⚽ Hẹn anh em ra sân!`,
            fallbackText: `Chốt ${attSnap.size} người tham gia`,
          })
          .catch((e) => console.error("[slack] A4 failed", e));

        await docSnap.ref.update({
          attendanceClosedNotified: true,
          attendanceClosedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }
);

/**
 * B1 — flush ATTEND queue. Gom các lần điểm danh trong cửa sổ thành 1 message.
 * Schedule: cfg.ATTEND_BATCH_MINUTES.
 */
exports.flushAttendQueue = onSchedule(
  {
    schedule: `every ${cfg.ATTEND_BATCH_MINUTES} minutes`,
    timeZone: TZ,
  },
  async () => {
    const db = admin.firestore();
    const staleCutoff = new Date(
      Date.now() - cfg.QUEUE_STALE_HOURS * 60 * 60 * 1000
    );
    const snap = await db
      .collection("slackQueue")
      .where("type", "==", "ATTEND")
      .get();
    if (snap.empty) return;

    const byMatch = new Map();
    const staleDocs = [];
    snap.forEach((d) => {
      const data = d.data();
      const enqueuedAt = data.enqueuedAt?.toDate?.();
      if (enqueuedAt && enqueuedAt < staleCutoff) {
        staleDocs.push(d.ref);
        return;
      }
      const key = data.matchId;
      if (!byMatch.has(key))
        byMatch.set(key, {
          matchDateLabel: data.matchDateLabel,
          names: [],
          docs: [],
        });
      byMatch.get(key).names.push(data.memberName);
      byMatch.get(key).docs.push(d.ref);
    });

    for (const [matchId, group] of byMatch) {
      const attSnap = await db
        .collection("matches")
        .doc(matchId)
        .collection("attendance")
        .get();
      const totalAttended = attSnap.size;
      const namesText = group.names.map((n) => `• ${n}`).join("\n");

      // Delete first to avoid duplicate on retry.
      const batch = db.batch();
      group.docs.forEach((ref) => batch.delete(ref));
      await batch.commit();

      await slack
        .sendBlock({
          headerText: `✅ ${group.names.length} người vừa điểm danh`,
          bodyMarkdown: `📅 Trận *${group.matchDateLabel}*\n\n${namesText}\n\n👥 Tổng đã điểm danh: *${totalAttended} người*\n\n🙌 Ai chưa điểm danh thì vào nhé!`,
          cta: {
            label: "Điểm danh ngay",
            url: `${slack.PUBLIC_WEB_URL}/attendance`,
            style: "primary",
          },
          fallbackText: `${group.names.length} người vừa điểm danh`,
        })
        .catch((e) => console.error("[slack] flushAttend failed", e));
    }

    if (staleDocs.length > 0) {
      const staleBatch = db.batch();
      staleDocs.forEach((ref) => staleBatch.delete(ref));
      await staleBatch.commit();
      console.log(`[slack] Deleted ${staleDocs.length} stale ATTEND items`);
    }
  }
);

/**
 * B2 — flush NOT_ATTEND + CANCEL_ATTEND + CANCEL_NOT_ATTEND.
 * Schedule: cfg.ATTENDANCE_CHANGE_BATCH_MINUTES.
 * CANCEL_ATTEND items hiển thị kèm timestamp hủy (quan trọng).
 */
exports.flushAttendanceChangeQueue = onSchedule(
  {
    schedule: `every ${cfg.ATTENDANCE_CHANGE_BATCH_MINUTES} minutes`,
    timeZone: TZ,
  },
  async () => {
    const db = admin.firestore();
    const staleCutoff = new Date(
      Date.now() - cfg.QUEUE_STALE_HOURS * 60 * 60 * 1000
    );
    const snap = await db
      .collection("slackQueue")
      .where("type", "in", ["NOT_ATTEND", "CANCEL_ATTEND", "CANCEL_NOT_ATTEND"])
      .get();
    if (snap.empty) return;

    const byMatch = new Map();
    const staleDocs = [];
    snap.forEach((d) => {
      const data = d.data();
      const enqueuedAt = data.enqueuedAt?.toDate?.();
      if (enqueuedAt && enqueuedAt < staleCutoff) {
        staleDocs.push(d.ref);
        return;
      }
      const key = data.matchId;
      if (!byMatch.has(key))
        byMatch.set(key, {
          matchDateLabel: data.matchDateLabel,
          notAttend: [],
          cancelAttend: [], // [{ name, time }]
          cancelNotAttend: [],
          docs: [],
        });
      const group = byMatch.get(key);
      const enqueuedLabel = enqueuedAt
        ? enqueuedAt.toLocaleString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
            timeZone: TZ,
          })
        : "";
      if (data.type === "NOT_ATTEND") group.notAttend.push(data.memberName);
      else if (data.type === "CANCEL_ATTEND")
        group.cancelAttend.push({ name: data.memberName, time: enqueuedLabel });
      else group.cancelNotAttend.push(data.memberName);
      group.docs.push(d.ref);
    });

    for (const [, group] of byMatch) {
      const sections = [];
      if (group.cancelAttend.length > 0) {
        sections.push(
          `⚠️ *Đã điểm danh nhưng HỦY:*\n${group.cancelAttend
            .map((it) => `   👤 ${it.name}${it.time ? ` _(🕐 ${it.time})_` : ""}`)
            .join("\n")}`
        );
      }
      if (group.notAttend.length > 0) {
        sections.push(
          `🚫 *Báo vắng:*\n${group.notAttend.map((n) => `   👤 ${n}`).join("\n")}`
        );
      }
      if (group.cancelNotAttend.length > 0) {
        sections.push(
          `↩️ *Hủy báo vắng:*\n${group.cancelNotAttend
            .map((n) => `   👤 ${n}`)
            .join("\n")}`
        );
      }
      if (sections.length === 0) continue;

      // Pick header based on highest-priority section.
      const headerText =
        group.cancelAttend.length > 0
          ? "⚠️ Có người hủy điểm danh"
          : "📝 Cập nhật báo vắng";

      // Delete first to avoid duplicate on retry.
      const batch = db.batch();
      group.docs.forEach((ref) => batch.delete(ref));
      await batch.commit();

      await slack
        .sendBlock({
          headerText,
          bodyMarkdown: `📅 Trận *${group.matchDateLabel}*\n\n${sections.join("\n\n")}`,
          fallbackText: headerText,
        })
        .catch((e) => console.error("[slack] flushChange failed", e));
    }

    if (staleDocs.length > 0) {
      const staleBatch = db.batch();
      staleDocs.forEach((ref) => staleBatch.delete(ref));
      await staleBatch.commit();
      console.log(`[slack] Deleted ${staleDocs.length} stale change items`);
    }
  }
);

/**
 * C3 — Nhắc nợ định kỳ. Schedule: cfg.DEBT_REMINDER_CRON.
 * Chỉ tính các trận đã PUBLISHED và còn share PENDING.
 */
exports.debtReminder = onSchedule(
  { schedule: cfg.DEBT_REMINDER_CRON, timeZone: TZ },
  async () => {
    const db = admin.firestore();

    // Step 1: get PUBLISHED matches
    const matchesSnap = await db
      .collection("matches")
      .where("status", "==", "PUBLISHED")
      .get();

    if (matchesSnap.empty) {
      console.log("[C3] No published matches");
      return;
    }

    // Build map: matchId -> { dateLabel, venueName }
    const matchMeta = new Map();
    matchesSnap.forEach((d) => {
      const data = d.data();
      if (data.isDeleted) return;
      matchMeta.set(d.id, {
        dateLabel: slack.formatMatchDate(data.date),
        venueName: data.venueName || null,
      });
    });

    if (matchMeta.size === 0) return;

    // Step 2: get all PENDING shares across published matches
    const pendingSnap = await db
      .collectionGroup("shares")
      .where("status", "==", "PENDING")
      .get();

    if (pendingSnap.empty) {
      console.log("[C3] No pending shares");
      return;
    }

    // Group by memberId, only include shares from published matches
    const byMember = new Map();
    pendingSnap.forEach((d) => {
      const data = d.data();
      const matchId = data.matchId || d.ref.parent.parent?.id;
      if (!matchId || !matchMeta.has(matchId)) return;
      if (!byMember.has(data.memberId)) {
        byMember.set(data.memberId, { items: [], total: 0 });
      }
      const grp = byMember.get(data.memberId);
      grp.items.push({
        matchId,
        dateLabel: matchMeta.get(matchId).dateLabel,
        amount: data.amount || 0,
      });
      grp.total += data.amount || 0;
    });

    if (byMember.size === 0) {
      console.log("[C3] No member owes anything for published matches");
      return;
    }

    // Resolve member names
    const memberIds = Array.from(byMember.keys());
    const nameMap = new Map();
    // Firestore "in" supports up to 30 elements per query
    for (const chunk of chunkArray(memberIds, 30)) {
      const memberSnap = await db
        .collection("members")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      memberSnap.forEach((m) => {
        nameMap.set(m.id, m.data().name || "Không rõ");
      });
    }

    // Build message — sort by total desc
    const sorted = Array.from(byMember.entries()).sort(
      (a, b) => b[1].total - a[1].total
    );
    const grandTotal = sorted.reduce((s, [, g]) => s + g.total, 0);

    const sections = sorted.map(([memberId, g]) => {
      const name = nameMap.get(memberId) || "Không rõ";
      const itemLines = g.items
        .map(
          (it) => `   📅 ${it.dateLabel}: 💰 ${slack.formatVnd(it.amount)} VND`
        )
        .join("\n");
      return `👤 *${name}* — 💰 *${slack.formatVnd(g.total)} VND*\n${itemLines}`;
    });

    // Slack message char limit ~3000 per text block — chunk if needed
    const headerMd = `💸 Còn *${sorted.length} người* nợ — tổng 💰 *${slack.formatVnd(
      grandTotal
    )} VND*\n\n🙏 Anh em vào thanh toán giúp nhé!`;

    const chunks = [];
    let buffer = "";
    for (const section of sections) {
      if (buffer.length + section.length + 2 > 2800) {
        chunks.push(buffer);
        buffer = section;
      } else {
        buffer = buffer ? `${buffer}\n\n${section}` : section;
      }
    }
    if (buffer) chunks.push(buffer);

    // First message has header; followups labelled (cont.)
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      await slack
        .sendBlock({
          headerText: isFirst
            ? "📌 Nhắc nợ định kỳ"
            : `📌 Nhắc nợ định kỳ (tiếp ${i + 1}/${chunks.length})`,
          bodyMarkdown: `${isFirst ? `${headerMd}\n\n` : ""}${chunks[i]}`,
          ...(isFirst
            ? {
                cta: {
                  label: "💳 Vào thanh toán",
                  url: `${slack.PUBLIC_WEB_URL}/pay`,
                  style: "primary",
                },
              }
            : {}),
          fallbackText: "Nhắc nợ định kỳ",
        })
        .catch((e) => console.error("[slack] C3 failed", e));
    }
  }
);

/**
 * A-daily — Nhắc nhở điểm danh hàng ngày/cách ngày.
 * Logic:
 *  - Còn ≤ REMINDER_DAILY_THRESHOLD_DAYS ngày: nhắc mỗi ngày.
 *  - Còn nhiều hơn: nhắc cách ngày (mỗi 2 ngày).
 *  - Bỏ qua nếu match đã đến mốc A3 (≤ 4h trước close) — A3 đảm nhận.
 *  - Bỏ qua nếu đã nhắc hôm nay (idempotent qua field lastDailyReminderDate).
 */
exports.dailyAttendanceReminder = onSchedule(
  { schedule: cfg.DAILY_REMINDER_CRON, timeZone: TZ },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const todayKey = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
    const a3WindowMs = cfg.ATTENDANCE_WARN_HOURS_BEFORE_CLOSE * 60 * 60 * 1000;

    const pendingSnap = await db
      .collection("matches")
      .where("status", "==", "PENDING")
      .get();

    if (pendingSnap.empty) {
      console.log("[daily-reminder] No pending matches");
      return;
    }

    for (const docSnap of pendingSnap.docs) {
      const data = docSnap.data();
      if (data.isDeleted) continue;
      if (!data.date?.toDate) continue;

      const matchDate = data.date.toDate();
      const closing = computeClosingTime(matchDate, data.attendanceCloseHours);

      // Skip if A3 will fire (or has fired) — avoid duplicate noise near close.
      if (closing && closing - now <= a3WindowMs) continue;
      // Skip if past closing time entirely.
      if (closing && now >= closing) continue;

      // Days until match (rounded up so "today" is 0, "tomorrow" is 1).
      const matchDayStart = new Date(matchDate);
      matchDayStart.setHours(0, 0, 0, 0);
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const daysUntil = Math.round(
        (matchDayStart - todayStart) / (24 * 60 * 60 * 1000)
      );
      if (daysUntil < 0) continue;

      // Decide whether to fire today.
      const lastReminded = data.lastDailyReminderDate || null;
      if (lastReminded === todayKey) continue;

      let shouldFire = false;
      if (daysUntil <= cfg.REMINDER_DAILY_THRESHOLD_DAYS) {
        // Daily — fire every day in this window.
        shouldFire = true;
      } else {
        // Every-other-day — only fire if it's been ≥ 2 days since last reminder.
        if (!lastReminded) {
          shouldFire = true;
        } else {
          const lastDate = new Date(`${lastReminded}T00:00:00`);
          const daysSinceLast = Math.round(
            (todayStart - lastDate) / (24 * 60 * 60 * 1000)
          );
          if (daysSinceLast >= 2) shouldFire = true;
        }
      }

      if (!shouldFire) continue;

      // Gather attendance.
      const matchId = docSnap.id;
      const [attSnap, notAttSnap] = await Promise.all([
        db.collection("matches").doc(matchId).collection("attendance").get(),
        db.collection("matches").doc(matchId).collection("not_attending").get(),
      ]);
      const attendeeNames = attSnap.docs
        .map((d) => d.data().memberName || "Không rõ")
        .sort((a, b) => a.localeCompare(b, "vi"));

      // Compose label.
      const daysLabel =
        daysUntil === 0
          ? "🚨 *Hôm nay*"
          : daysUntil === 1
            ? "⏰ *Ngày mai*"
            : `📆 Còn *${daysUntil} ngày*`;

      const attendeesSection =
        attSnap.size > 0
          ? `\n\n✅ *Đã điểm danh ${attSnap.size} người:*\n${attendeeNames
              .map((n) => `   👤 ${n}`)
              .join("\n")}`
          : "\n\n😴 _Chưa có ai điểm danh._";

      const absentSection =
        notAttSnap.size > 0
          ? `\n\n🚫 _Báo vắng: ${notAttSnap.size} người_`
          : "";

      await slack
        .sendBlock({
          headerText: "🔔 Nhắc nhở điểm danh",
          bodyMarkdown: `📅 Trận *${slack.formatMatchDate(data.date)}*${
            data.venueName ? `\n📍 ${data.venueName}` : ""
          }\n\n${daysLabel} đến trận.${attendeesSection}${absentSection}\n\n🏃 Anh em check nhanh giúp nhé!`,
          cta: {
            label: "Điểm danh ngay",
            url: `${slack.PUBLIC_WEB_URL}/attendance`,
            style: "primary",
          },
          fallbackText: "Nhắc nhở điểm danh",
        })
        .catch((e) => console.error("[slack] daily-reminder failed", e));

      await docSnap.ref.update({ lastDailyReminderDate: todayKey });
    }
  }
);
