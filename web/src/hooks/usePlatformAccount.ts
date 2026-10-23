import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";

export type PlatformAccount = { uid: string; email: string; displayName: string; role: "owner" | "user"; status: "active" | "disabled"; createdAt?: { _seconds?: number; seconds?: number } };
export const usePlatformAccount = () => {
  const { user } = useAuth();
  const [state, setState] = useState<{ uid?: string; account: PlatformAccount | null; loading: boolean }>({ account: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    if (!user) { setState({ account: null, loading: false }); return; }
    setState({ uid: user.uid, account: null, loading: true });
    getDoc(doc(db, "platformAccounts", user.uid)).then((snapshot) => {
      if (cancelled) return;
      const data = snapshot.data();
      const account = snapshot.exists() && data?.status === "active" ? { ...data, uid: user.uid } as PlatformAccount : null;
      setState({ uid: user.uid, account, loading: false });
    }).catch(() => { if (!cancelled) setState({ uid: user.uid, account: null, loading: false }); });
    return () => { cancelled = true; };
  }, [user]);
  return state.uid === user?.uid ? { account: state.account, loading: state.loading } : { account: null, loading: !!user };
};
