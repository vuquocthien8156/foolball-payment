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

apiRoutes.post("/create-payment-link", async (req, res) => {
  const { shareIds, memberId } = req.body;

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
      const sharesQuery = db
        .collectionGroup("shares")
        .where("payosOrderCode", "==", orderCode);
      const snapshot = await sharesQuery.get();

      if (snapshot.empty) {
        console.error(`Webhook: No shares found for orderCode ${orderCode}`);
        return res.status(200).json({ warning: "No shares found for order." });
      }

      const batch = db.batch();
      // Fetch member details to include in the notification
      const memberId = snapshot.docs[0].data().memberId;
      const memberDoc = await db.collection("members").doc(memberId).get();
      const memberName = memberDoc.exists
        ? memberDoc.data().name
        : "Một thành viên";

      snapshot.docs.forEach((doc) => {
        const shareData = doc.data();
        if (shareData.status !== "PAID") {
          batch.update(doc.ref, {
            status: "PAID",
            paidAt: new Date().toISOString(),
            channel: "PAYOS",
            meta: { webhook: webhookData },
          });
 
          // Create a notification for each paid share
          const notificationRef = db.collection("notifications").doc();
          // Get matchId directly from the share document
          const matchId = shareData.matchId;
          if (!matchId) {
            console.error(
              `CRITICAL: matchId is missing in share document ${doc.id} for orderCode ${orderCode}. Skipping notification.`
            );
            // Continue to the next iteration without creating a notification
            return;
          }
          batch.set(notificationRef, {
            message: `${memberName} đã thanh toán ${shareData.amount.toLocaleString()} VND`,
            matchId: matchId,
            shareId: doc.id,
            isRead: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });
      await batch.commit();
      console.log(
        `Successfully updated ${snapshot.size} shares to PAID for orderCode: ${orderCode}`
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

// Mount the API router under the /api prefix
app.use("/api", apiRoutes);

// --- Start Server ---
// app.listen(port, () => {
//   console.log(`Server is listening on port ${port}`);
// });

// Export the Express API as a Cloud Function
exports.api = onRequest({ invoker: "public" }, app);
