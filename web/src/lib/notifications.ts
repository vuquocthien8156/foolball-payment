import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { db, requestNotificationPermission } from "@/lib/firebase";

export const saveNotificationToken = async (
  token: string,
  memberId?: string | null
) => {
  const tokenRef = doc(db, "notificationTokens", token);
  await setDoc(
    tokenRef,
    {
      token,
      memberId: memberId || null,
      updatedAt: serverTimestamp(),
      userAgent: navigator.userAgent,
    },
    { merge: true }
  );

  if (memberId) {
    const memberRef = doc(db, "members", memberId);
    await setDoc(
      memberRef,
      { fcmToken: token, fcmTokenUpdatedAt: serverTimestamp() },
      { merge: true }
    );
  }
};

export const removeNotificationToken = async (
  token: string | null,
  memberId?: string | null
) => {
  if (token) {
    await deleteDoc(doc(db, "notificationTokens", token));
  }
  if (memberId) {
    await setDoc(
      doc(db, "members", memberId),
      { fcmToken: null, fcmTokenUpdatedAt: serverTimestamp() },
      { merge: true }
    );
  }
};

export const ensureNotificationToken = async (memberId?: string | null) => {
  const token = await requestNotificationPermission();
  if (!token) return null;
  await saveNotificationToken(token, memberId);
  return token;
};

export const fetchStoredMemberToken = async (memberId: string) => {
  const snap = await getDoc(doc(db, "members", memberId));
  if (snap.exists()) {
    const token = snap.data().fcmToken as string | undefined;
    return token || null;
  }
  return null;
};
