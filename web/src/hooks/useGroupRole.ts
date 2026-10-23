import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { DEFAULT_GROUP_ID } from "@/lib/groups";
type GroupRole = { role: "owner" | "manager" | "admin" | null; tabs: string[] };
const emptyRole: GroupRole = { role: null, tabs: [] };
export async function resolveClientGroupRole(uid: string, groupId: string): Promise<GroupRole> {
  const platform = await getDoc(doc(db, "platformAccounts", uid));
  if (platform.exists()) {
    if (platform.data().status !== "active") return emptyRole;
    if (platform.data().role === "owner") return { role: "owner", tabs: [] };
  }
  const membership = await getDoc(doc(db, "groupMembers", `${groupId}_${uid}`));
  if (membership.exists()) {
    const data = membership.data();
    return ["manager", "admin"].includes(data.role) ? { role: data.role, tabs: Array.isArray(data.tabs) ? data.tabs : [] } : emptyRole;
  }
  if (groupId === DEFAULT_GROUP_ID) {
    const legacy = await getDoc(doc(db, "userRoles", uid));
    const data = legacy.data();
    if (data?.roles?.includes("superadmin")) return { role: "manager", tabs: [] };
    if (data?.roles?.includes("admin")) return { role: "admin", tabs: Array.isArray(data.tabs) ? data.tabs : [] };
  }
  return emptyRole;
}
export function useGroupRole(groupId: string) {
  const { user } = useAuth();
  const key = user ? `${groupId}_${user.uid}` : "";
  const [state, setState] = useState<{ key: string; value: GroupRole; loading: boolean }>({ key: "", value: emptyRole, loading: true });
  useEffect(() => {
    let cancelled = false;
    if (!user) { setState({ key, value: emptyRole, loading: false }); return; }
    setState({ key, value: emptyRole, loading: true });
    resolveClientGroupRole(user.uid, groupId).then((value) => { if (!cancelled) setState({ key, value, loading: false }); })
      .catch(() => { if (!cancelled) setState({ key, value: emptyRole, loading: false }); });
    return () => { cancelled = true; };
  }, [user, groupId, key]);
  const value = state.key === key ? state.value : emptyRole;
  return { ...value, loading: state.key !== key || state.loading, isManager: value.role === "owner" || value.role === "manager" };
}
