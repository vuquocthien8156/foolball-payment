import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { defaultActionWeights, ActionWeights } from "@/lib/liveStats";

export interface ActionConfig {
  key: string;
  label: string;
  type: "ok" | "bad";
  weight?: number;
  color?: string;
  order?: number;
  isNegative?: boolean;
}

const defaultConfigs: ActionConfig[] = [
  { key: "goal", label: "Bàn thắng", type: "ok", weight: 2, color: "bg-emerald-100 text-emerald-700", order: 1 },
  { key: "assist", label: "Kiến tạo", type: "ok", weight: 1.5, color: "bg-blue-100 text-blue-700", order: 2 },
  { key: "save_gk", label: "Cản phá GK", type: "ok", weight: 1.2, color: "bg-cyan-100 text-cyan-700", order: 3 },
  { key: "tackle", label: "Tackle/Chặn", type: "ok", weight: 0.8, color: "bg-indigo-100 text-indigo-700", order: 4 },
  { key: "dribble", label: "Qua người", type: "ok", weight: 0.5, color: "bg-purple-100 text-purple-700", order: 5 },
  { key: "note", label: "Ghi chú", type: "ok", weight: 0.3, color: "bg-slate-100 text-slate-700", order: 6 },
  { key: "yellow", label: "Thẻ vàng", type: "bad", weight: 0.5, color: "bg-amber-100 text-amber-800", order: 1, isNegative: true },
  { key: "red", label: "Thẻ đỏ", type: "bad", weight: 1, color: "bg-red-100 text-red-700", order: 2, isNegative: true },
  { key: "foul", label: "Phạm lỗi", type: "bad", weight: 0.2, color: "bg-slate-100 text-slate-700", order: 3, isNegative: true },
];

export const useActionConfigs = () => {
  const [actions, setActions] = useState<ActionConfig[]>(defaultConfigs);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "actionConfigs"), orderBy("order", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setActions(defaultConfigs);
          setLoading(false);
          return;
        }
        const list: ActionConfig[] = snap.docs.map((d) => ({
          key: d.id,
          ...(d.data() as any),
        }));
        setActions(list);
        setLoading(false);
      },
      () => {
        setActions(defaultConfigs);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const okActions = useMemo(
    () => actions.filter((a) => a.type !== "bad" && !a.isNegative),
    [actions]
  );
  const badActions = useMemo(
    () => actions.filter((a) => a.type === "bad" || a.isNegative),
    [actions]
  );
  const labelMap = useMemo(() => {
    const map = new Map<string, string>();
    actions.forEach((a) => map.set(a.key, a.label));
    return map;
  }, [actions]);

  const weights: ActionWeights = useMemo(() => {
    const w: ActionWeights = { ...defaultActionWeights, extras: [] };
    actions.forEach((a) => {
      if (typeof a.weight !== "number") return;
      if (Object.prototype.hasOwnProperty.call(defaultActionWeights, a.key)) {
        (w as any)[a.key] = a.weight;
      } else {
        w.extras?.push({
          key: a.key,
          label: a.label,
          weight: a.weight,
          isNegative: a.isNegative,
        });
      }
    });
    return w;
  }, [actions]);

  return { actions, okActions, badActions, labelMap, weights, loading };
};
