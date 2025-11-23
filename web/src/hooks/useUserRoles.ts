import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type UserRole = "admin" | "scoring-admin" | string;

export const useUserRoles = (uid?: string | null) => {
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(!!uid);

  useEffect(() => {
    if (!uid) {
      setRoles([]);
      setTabs([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const fetchRoles = async () => {
      try {
        const docRef = doc(db, "userRoles", uid);
        const snap = await getDoc(docRef);
        if (active) {
          const data = snap.data();
          const rolesArray = Array.isArray(data?.roles) ? data.roles : [];
          const tabArray = Array.isArray((data as any)?.tabs)
            ? ((data as any).tabs as string[])
            : [];
          console.info("[useUserRoles] fetched roles", {
            uid,
            exists: snap.exists(),
            roles: rolesArray,
            tabs: tabArray,
          });
          setRoles(rolesArray);
          setTabs(tabArray);
        }
      } catch (err) {
        console.error("[useUserRoles] Error fetching user roles", { uid, err });
        if (active) {
          setRoles([]);
          setTabs([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchRoles();
    return () => {
      active = false;
    };
  }, [uid]);

  return { roles, tabs, loading };
};
