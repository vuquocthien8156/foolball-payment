// Scripts for firebase and firebase messaging
importScripts(
  "https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js"
);

// Initialize the Firebase app in the service worker
// "Default" Firebase configuration (prevents errors)
const firebaseConfig = {
  apiKey: "AIzaSyDn5uzZ3BgewpBcv5VHXXNm7RNKe1Pi3Yg",
  authDomain: "foolball-payment.firebaseapp.com",
  projectId: "foolball-payment",
  storageBucket: "foolball-payment.appspot.com",
  messagingSenderId: "398658240449",
  appId: "1:398658240449:web:da59bcb3a2f7c1db2c3940",
  measurementId: "G-TC5GWMCLL9",
};

firebase.initializeApp(firebaseConfig);

// Retrieve an instance of Firebase Messaging so that it can handle background
// messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Received background message ",
    payload
  );
  // Customize notification here
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: "/pwa-192x192.png", // Or your app's icon
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
