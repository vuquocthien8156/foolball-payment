// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDn5uzZ3BgewpBcv5VHXXNm7RNKe1Pi3Yg",
  authDomain: "foolball-payment.firebaseapp.com",
  projectId: "foolball-payment",
  storageBucket: "foolball-payment.appspot.com",
  messagingSenderId: "398658240449",
  appId: "1:398658240449:web:da59bcb3a2f7c1db2c3940",
  measurementId: "G-TC5GWMCLL9",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);
const messaging = getMessaging(app);

// Function to request permission and get token
export const requestNotificationPermission = async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      console.log("Notification permission granted.");
      const currentToken = await getToken(messaging, {
        vapidKey:
          "BPwIdXHEntWSQ9AGkKSy7dcN7aO4TYQ67mV627wzVAvfPkFKau2DB7C8A91KRepbeBY93Pv9XsX_kn2Jv-5cn7Y",
      });
      if (currentToken) {
        console.log("FCM Token:", currentToken);
        return currentToken;
      } else {
        console.log(
          "No registration token available. Request permission to generate one."
        );
        return null;
      }
    } else {
      console.log("Unable to get permission to notify.");
      return null;
    }
  } catch (err) {
    console.error("An error occurred while retrieving token. ", err);
    return null;
  }
};

// Listen for foreground messages
onMessage(messaging, (payload) => {
  console.log("Message received. ", payload);
  // You can display a toast notification here
  // For example, using a library like react-toastify or a custom component
  new Notification(payload.notification.title, {
    body: payload.notification.body,
    icon: "/pwa-192x192.png",
  });
});

export { app, db, analytics, auth };
