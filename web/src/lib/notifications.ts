import { doc, getDoc } from "firebase/firestore";
import { apiRequest, postApiJson } from "@/lib/api";
import { db, requestNotificationPermission } from "@/lib/firebase";

export const saveNotificationToken = async (
  token: string,
  memberId: string | null | undefined,
  groupId: string
) => {
  await postApiJson(`/public/${groupId}/notification-token`, {
    token,
    memberId: memberId || null,
  });
};

export const removeNotificationToken = async (
  token: string | null,
  groupId: string
) => {
  if (token) {
    await apiRequest("DELETE", `/public/${groupId}/notification-token`, { token });
  }
};

export const ensureNotificationToken = async (memberId: string | null | undefined, groupId: string) => {
  const token = await requestNotificationPermission();
  if (!token) return null;
  await saveNotificationToken(token, memberId, groupId);
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
