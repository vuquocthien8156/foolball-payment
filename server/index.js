// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PayOS } = require("@payos/node");
const admin = require("firebase-admin");

// --- Firebase Admin SDK Initialization ---
// Ensure you have the service account key file in the `server` directory
try {
  let serviceAccount;
  // Check if the FIREBASE_CREDENTIALS environment variable is set (for production)
  if (process.env.FIREBASE_CREDENTIALS) {
    // Parse the credentials from the environment variable
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  } else {
    // Fallback to the local service account file (for development)
    serviceAccount = require("./foolball-payment-firebase-adminsdk-fbsvc-24ed542325.json");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("Failed to initialize Firebase Admin SDK:", error);
  process.exit(1); // Exit if Firebase connection fails
}

// --- PayOS Initialization ---
const payos = new PayOS(
  process.env.PAYOS_CLIENT_ID,
  process.env.PAYOS_API_KEY,
  process.env.PAYOS_CHECKSUM_KEY
);

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares ---
app.use(cors()); // Configure this properly for production
app.use(express.json());

// --- Routes ---
app.post("/create-payment-link", async (req, res) => {
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

    // No need to store checkoutUrl in a separate collection anymore
    res.json({ checkoutUrl: paymentLink.checkoutUrl });
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
          batch.set(notificationRef, {
            message: `${memberName} đã thanh toán ${shareData.amount.toLocaleString()} VND`,
            matchId: shareData.matchId,
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

app.get("/payos-webhook", (req, res) => {
  res.status(200).send("Webhook URL is active and ready to receive data.");
});
app.post("/payos-webhook", payosWebhookHandler);
app.put("/payos-webhook", payosWebhookHandler);

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
