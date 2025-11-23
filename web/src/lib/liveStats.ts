export type LiveEventType =
  | "goal"
  | "assist"
  | "yellow"
  | "red"
  | "foul"
  | "save_gk"
  | "tackle"
  | "dribble"
  | "note"
  | string; // allow custom actions if được cấu hình thêm

export interface LiveEventRecord {
  memberId?: string;
  type: LiveEventType;
}

export interface ActionWeights {
  goal: number;
  assist: number;
  save_gk: number;
  tackle: number;
  dribble: number;
  note: number;
  yellow: number;
  red: number;
  foul: number;
  extras?: {
    key: string;
    label?: string;
    weight: number;
    isNegative?: boolean;
  }[];
}

export const defaultActionWeights: ActionWeights = {
  goal: 2,
  assist: 1.5,
  save_gk: 1.2,
  tackle: 0.8,
  dribble: 0.5,
  note: 0.3,
  yellow: 0.5,
  red: 1,
  foul: 0.2,
};

export interface AggregatedStat {
  memberId: string;
  goal: number;
  assist: number;
  yellow: number;
  red: number;
  foul: number;
  save_gk: number;
  tackle: number;
  dribble: number;
  note: number;
  total: number;
  primaryScore: number;
}

const emptyStat = (): AggregatedStat => ({
  memberId: "",
  goal: 0,
  assist: 0,
  yellow: 0,
  red: 0,
  foul: 0,
  save_gk: 0,
  tackle: 0,
  dribble: 0,
  note: 0,
  total: 0,
  primaryScore: 0,
});

export const aggregateLiveStats = (
  events: LiveEventRecord[],
  weights: ActionWeights = defaultActionWeights
): Map<string, AggregatedStat> => {
  const map = new Map<string, AggregatedStat>();
  const extraMap = new Map<
    string,
    { weight: number; isNegative?: boolean }
  >();
  (weights.extras || []).forEach((ex) => {
    if (!ex.key) return;
    extraMap.set(ex.key, { weight: ex.weight, isNegative: ex.isNegative });
  });

  events.forEach((ev) => {
    if (!ev.memberId) return;
    const current =
      map.get(ev.memberId) || { ...emptyStat(), memberId: ev.memberId };

    const isPositive =
      ev.type === "goal" ||
      ev.type === "assist" ||
      ev.type === "save_gk" ||
      ev.type === "tackle" ||
      ev.type === "dribble" ||
      ev.type === "note" ||
      (extraMap.has(ev.type) && !extraMap.get(ev.type)?.isNegative);

    switch (ev.type) {
      case "goal":
        current.goal += 1;
        break;
      case "assist":
        current.assist += 1;
        break;
      case "yellow":
        current.yellow += 1;
        break;
      case "red":
        current.red += 1;
        break;
      case "foul":
        current.foul += 1;
        break;
      case "save_gk":
        current.save_gk += 1;
        break;
      case "tackle":
        current.tackle += 1;
        break;
      case "dribble":
        current.dribble += 1;
        break;
      case "note":
        current.note += 1;
        break;
      default:
        // custom action -> store as dynamic counter
        if (extraMap.has(ev.type)) {
          const key = ev.type;
          (current as any)[key] = ((current as any)[key] || 0) + 1;
        }
        break;
    }

    if (isPositive) {
      current.total += 1;
    }
    const positiveScore =
      current.goal * weights.goal +
      current.assist * weights.assist +
      current.save_gk * weights.save_gk +
      current.tackle * weights.tackle +
      current.dribble * weights.dribble +
      current.note * weights.note +
      Array.from(extraMap.entries()).reduce((sum, [key, cfg]) => {
        if (cfg.isNegative) return sum;
        const count = (current as any)[key] || 0;
        return sum + count * cfg.weight;
      }, 0);
    const penaltyScore =
      current.yellow * weights.yellow +
      current.red * weights.red +
      current.foul * weights.foul +
      Array.from(extraMap.entries()).reduce((sum, [key, cfg]) => {
        if (!cfg.isNegative) return sum;
        const count = (current as any)[key] || 0;
        return sum + count * cfg.weight;
      }, 0);
    current.primaryScore = positiveScore - penaltyScore;
    map.set(ev.memberId, current);
  });

  return map;
};
