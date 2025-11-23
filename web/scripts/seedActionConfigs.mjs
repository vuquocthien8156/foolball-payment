import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(__dirname, "..", ".env.local"),
  path.resolve(__dirname, "..", ".env"),
  path.resolve(__dirname, "..", "..", ".env.local"),
  path.resolve(__dirname, "..", "..", ".env"),
];

envCandidates.forEach((p) => {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
});

const requiredEnv = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(
    `Missing env variables: ${missing.join(
      ", "
    )}. Please export VITE_FIREBASE_* before running.`
  );
  process.exit(1);
}

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

const seeds = [
  {
    key: "goal",
    data: {
      label: "Bàn thắng",
      type: "ok",
      weight: 2,
      color: "bg-emerald-100 text-emerald-700",
      order: 1,
    },
  },
  {
    key: "assist",
    data: {
      label: "Kiến tạo",
      type: "ok",
      weight: 1.5,
      color: "bg-blue-100 text-blue-700",
      order: 2,
    },
  },
  {
    key: "save_gk",
    data: {
      label: "Cản phá GK",
      type: "ok",
      weight: 1.2,
      color: "bg-cyan-100 text-cyan-700",
      order: 3,
    },
  },
  {
    key: "tackle",
    data: {
      label: "Tackle/Chặn",
      type: "ok",
      weight: 0.8,
      color: "bg-indigo-100 text-indigo-700",
      order: 4,
    },
  },
  {
    key: "dribble",
    data: {
      label: "Qua người",
      type: "ok",
      weight: 0.5,
      color: "bg-purple-100 text-purple-700",
      order: 5,
    },
  },
  {
    key: "note",
    data: {
      label: "Ghi chú",
      type: "ok",
      weight: 0.3,
      color: "bg-slate-100 text-slate-700",
      order: 6,
    },
  },
  {
    key: "yellow",
    data: {
      label: "Thẻ vàng",
      type: "bad",
      weight: 0.5,
      color: "bg-amber-100 text-amber-800",
      order: 1,
      isNegative: true,
    },
  },
  {
    key: "red",
    data: {
      label: "Thẻ đỏ",
      type: "bad",
      weight: 1,
      color: "bg-red-100 text-red-700",
      order: 2,
      isNegative: true,
    },
  },
  {
    key: "foul",
    data: {
      label: "Phạm lỗi",
      type: "bad",
      weight: 0.2,
      color: "bg-slate-100 text-slate-700",
      order: 3,
      isNegative: true,
    },
  },
];

const main = async () => {
  console.log("Seeding actionConfigs...");
  for (const seed of seeds) {
    const ref = doc(db, "actionConfigs", seed.key);
    const exists = await getDoc(ref);
    await setDoc(ref, { ...seed.data }, { merge: true });
    console.log(`${exists.exists() ? "Updated" : "Created"} ${seed.key}`);
  }
  console.log("Done. actionConfigs ready.");
  process.exit(0);
};

main().catch((err) => {
  console.error("Failed to seed actionConfigs", err);
  process.exit(1);
});
