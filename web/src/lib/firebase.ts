// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDn5uzZ3BgewpBcv5VHXXNm7RNKe1Pi3Yg",
  authDomain: "foolball-payment.firebaseapp.com",
  projectId: "foolball-payment",
  storageBucket: "foolball-payment.firebasestorage.app",
  messagingSenderId: "398658240449",
  appId: "1:398658240449:web:da59bcb3a2f7c1db2c3940",
  measurementId: "G-TC5GWMCLL9",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Emulator connections can be managed here if needed in the future,
// e.g., connectFirestoreEmulator, connectAuthEmulator, etc.

export { app, db, analytics, auth };
