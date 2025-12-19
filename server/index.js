// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PayOS } = require("@payos/node");
const admin = require("firebase-admin");
const axios = require("axios");
const { onRequest } = require("firebase-functions/v2/https");

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
    const description = `Thanh toan ${orderCode}`;

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
          }
        });

        // 5. Update the payment request status
        transaction.update(paymentRequestRef, {
          status: "PAID",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      console.log(
        `Successfully processed payment and ratings for orderCode: ${orderCode}`
      );
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
        const attendanceRef = attendanceCollectionRef.doc(doc.id);
        // Use set with merge: true or create helper to avoid overwriting timestamp if already exists?
        // Requirements say "auto attendance", implying they haven't attended yet.
        // We can just set it. If they already attended manually (unlikely if this is "created"), it's fine.
        // We set timestamp to now.
        batch.set(
          attendanceRef,
          {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            memberName: memberData.name,
            userAgent: "Auto Attendance (System)",
          },
          { merge: true }
        ); // merge true ensures we don't wipe other fields if any exist in future
      });

      await batch.commit();
      console.log(
        `Auto-attended ${autoMembersSnap.size} members for match ${matchId}`
      );
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
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("Error sending attendance-deleted notification:", error);
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

// Mount the API router under the /api prefix
app.use("/api", apiRoutes);

// --- Start Server ---
// app.listen(port, () => {
//   console.log(`Server is listening on port ${port}`);
// });

// Export the Express API as a Cloud Function
exports.api = onRequest({ invoker: "public" }, app);
