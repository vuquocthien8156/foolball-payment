import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME, groupPath, isValidGroupId } from "@/lib/groups";
import NotFound from "@/pages/NotFound";

export type Group = { name: string; kind?: string; sport?: string; status?: string; ownerUid?: string };
type GroupState = { groupId: string; group: Group | null; loading: boolean; notFound: boolean };
const GroupContext = createContext<GroupState | null>(null);

export const GroupProvider = ({ children }: { children: ReactNode }) => {
  const { groupId = "" } = useParams();
  const valid = isValidGroupId(groupId);
  const [state, setState] = useState<GroupState>({ groupId: "", group: null, loading: true, notFound: false });
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    getDoc(doc(db, "groups", groupId)).then((snapshot) => {
      if (cancelled) return;
      const group = snapshot.exists() ? snapshot.data() as Group : groupId === DEFAULT_GROUP_ID
        ? { name: DEFAULT_GROUP_NAME, sport: "football" } : null;
      const isNotFound = !group || group.status === "archived";
      if (!isNotFound && typeof localStorage !== "undefined") {
        try { localStorage.setItem("lastActiveGroupId", groupId); } catch {}
      }
      setState({ groupId, group, loading: false, notFound: isNotFound });
    }).catch((error) => {
      if (cancelled) return;
      console.error("Unable to load group", error);
      setState({ groupId, group: null, loading: false, notFound: true });
    });
    return () => { cancelled = true; };
  }, [groupId, valid]);
  const value = state.groupId === groupId ? state : { groupId, group: null, loading: true, notFound: false };
  if (!valid || value.notFound) return <NotFound />;
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
};

export const useGroup = () => {
  const context = useContext(GroupContext);
  if (!context) throw new Error("useGroup requires GroupProvider");
  return context;
};
export const useGroupPath = () => {
  const { groupId } = useGroup();
  return useCallback((sub = "") => groupPath(groupId, sub), [groupId]);
};
