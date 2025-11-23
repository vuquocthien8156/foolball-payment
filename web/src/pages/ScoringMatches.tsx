import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Loader2, Search, Trophy, FilePenLine } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  AggregatedStat,
  LiveEventRecord,
  aggregateLiveStats,
  ActionWeights,
  defaultActionWeights,
} from "@/lib/liveStats";
import { useActionConfigs } from "@/hooks/useActionConfigs";

interface Match {
  id: string;
  date: Timestamp | string;
  status: "PENDING" | "COMPLETED" | "PUBLISHED";
  isDeleted?: boolean;
  teamsConfig?: { id: string; name: string }[];
  teamNames?: Record<string, string>;
}

interface Share {
  memberId: string;
  teamId: string;
  teamName?: string;
}

interface RatingData {
  averageScore: number;
  totalPoints: number;
  ratingCount: number;
}

interface AdminRating {
  memberId: string;
  score: number;
  notes?: string;
  updatedAt?: Timestamp;
}

const quickNotes = [
  { label: "1 bàn thắng", delta: 0.8 },
  { label: "Hattrick", delta: 1.5 },
  { label: "GK cản phá 3 quả", delta: 0.8 },
  { label: "Tackle/đánh chặn 5 lần", delta: 0.8 },
  { label: "Rê qua người 3 lần", delta: 0.6 },
  { label: "Nỗ lực đặc biệt/Other", delta: 0.5 },
];

const ScoringMatches = () => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [shares, setShares] = useState<Share[]>([]);
  const [playerRatings, setPlayerRatings] = useState<
    Map<string, RatingData>
  >(new Map());
  const [adminRatings, setAdminRatings] = useState<Map<string, AdminRating>>(
    new Map()
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMatchData, setIsLoadingMatchData] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<{
    memberId: string;
    name: string;
  } | null>(null);
  const [adminScoreInput, setAdminScoreInput] = useState<number>(0);
  const [adminNotes, setAdminNotes] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [liveStatsMap, setLiveStatsMap] = useState<Map<string, AggregatedStat>>(
    new Map()
  );
  const [isLoadingLiveStats, setIsLoadingLiveStats] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEventRecord[]>([]);
  const [actionWeights, setActionWeights] =
    useState<ActionWeights>(defaultActionWeights);
  const [newAction, setNewAction] = useState<{
    key: string;
    label: string;
    weight: string;
    isNegative: boolean;
  }>({ key: "", label: "", weight: "0.5", isNegative: false });
  const { labelMap, weights, loading: actionsLoading } = useActionConfigs();

  useEffect(() => {
    const fetchMembers = async () => {
      const snapshot = await getDocs(collection(db, "members"));
      const map = new Map(
        snapshot.docs.map((doc) => [doc.id, doc.data().name as string])
      );
      setMembers(map);
    };
    fetchMembers();
  }, []);

  useEffect(() => {
    setIsLoading(true);
    const matchesQuery = query(
      collection(db, "matches"),
      where("status", "in", ["PUBLISHED", "COMPLETED"]),
      orderBy("date", "desc")
    );
    const unsubscribe = onSnapshot(matchesQuery, (snapshot) => {
      const list = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Match))
        .filter((m) => !m.isDeleted);
      setMatches(list);
      if (!selectedMatchId && list.length > 0) {
        setSelectedMatchId(list[0].id);
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchId) return;
    setIsLoadingMatchData(true);
    // weights now driven by useActionConfigs
    const sharesQuery = query(
      collection(db, "matches", selectedMatchId, "shares")
    );
    const unsubscribeShares = onSnapshot(sharesQuery, (snapshot) => {
      const currentMatch = matches.find((m) => m.id === selectedMatchId);
      let teamNames: Record<string, string> = {};
      if (currentMatch?.teamsConfig) {
        teamNames = currentMatch.teamsConfig.reduce((acc, team) => {
          acc[team.id] = team.name;
          return acc;
        }, {} as Record<string, string>);
      } else if (currentMatch?.teamNames) {
        teamNames = currentMatch.teamNames;
      }
      const data: Share[] = snapshot.docs.map((doc) => ({
        memberId: doc.data().memberId,
        teamId: doc.data().teamId,
        teamName: teamNames[doc.data().teamId] || `Đội ${doc.data().teamId}`,
      }));
      setShares(data);
      setIsLoadingMatchData(false);
    });

    const liveEventsQuery = query(
      collection(db, "matches", selectedMatchId, "liveEvents")
    );
    setIsLoadingLiveStats(true);
    const unsubscribeLive = onSnapshot(
      liveEventsQuery,
      (snapshot) => {
        const events: LiveEventRecord[] = snapshot.docs.map((doc) => ({
          ...(doc.data() as LiveEventRecord),
        }));
        setLiveEvents(events);
        setIsLoadingLiveStats(false);
      },
      () => {
        setIsLoadingLiveStats(false);
      }
    );

    const ratingsQuery = query(
      collection(db, "matches", selectedMatchId, "ratings")
    );
    const unsubscribeRatings = onSnapshot(ratingsQuery, (snapshot) => {
      const ratingsByPlayer = new Map<string, RatingData>();
      snapshot.forEach((doc) => {
        const rating = doc.data();
        rating.playerRatings.forEach(
          (playerRating: { memberId: string; score: number }) => {
            const current = ratingsByPlayer.get(playerRating.memberId) || {
              averageScore: 0,
              totalPoints: 0,
              ratingCount: 0,
            };
            current.totalPoints += playerRating.score;
            current.ratingCount += 1;
            ratingsByPlayer.set(playerRating.memberId, current);
          }
        );
      });
      ratingsByPlayer.forEach((data, key) => {
        ratingsByPlayer.set(key, {
          ...data,
          averageScore: data.totalPoints / data.ratingCount,
        });
      });
      setPlayerRatings(ratingsByPlayer);
    });

    const adminRatingsQuery = query(
      collection(db, "matches", selectedMatchId, "adminRatings")
    );
    const unsubscribeAdmin = onSnapshot(adminRatingsQuery, (snapshot) => {
      const map = new Map<string, AdminRating>();
      snapshot.forEach((docSnap) => {
        map.set(docSnap.id, { memberId: docSnap.id, ...docSnap.data() } as any);
      });
      setAdminRatings(map);
    });

    return () => {
      unsubscribeShares();
      unsubscribeLive();
      unsubscribeRatings();
      unsubscribeAdmin();
    };
  }, [selectedMatchId, matches]);

  useEffect(() => {
    if (!actionsLoading) setActionWeights(weights);
  }, [actionsLoading, weights]);

  useEffect(() => {
    setLiveStatsMap(aggregateLiveStats(liveEvents, actionWeights));
  }, [liveEvents, actionWeights]);

  const currentTeamNames = useMemo(() => {
    const found = matches.find((m) => m.id === selectedMatchId);
    if (!found) return {};
    if (found.teamsConfig) {
      return found.teamsConfig.reduce((acc, t) => {
        acc[t.id] = t.name;
        return acc;
      }, {} as Record<string, string>);
    }
    return found.teamNames || {};
  }, [matches, selectedMatchId]);

  const players = useMemo(() => {
    const unique = new Map<string, Share>();
    shares.forEach((s) => {
      if (!unique.has(s.memberId)) unique.set(s.memberId, s);
    });
    return Array.from(unique.values()).filter((p) => {
      const name = members.get(p.memberId) || "";
      return searchTerm
        ? name.toLowerCase().includes(searchTerm.toLowerCase())
        : true;
    });
  }, [shares, members, searchTerm]);

  const memberTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    shares.forEach((s) => {
      map.set(s.memberId, s.teamName || "");
    });
    return map;
  }, [shares]);

  const memberTeamIdMap = useMemo(() => {
    const map = new Map<string, string>();
    shares.forEach((s) => map.set(s.memberId, s.teamId));
    const matchCfg = matches.find((m) => m.id === selectedMatchId);
    if (matchCfg?.teamsConfig) {
      matchCfg.teamsConfig.forEach((team) => {
        (team as any).members?.forEach((m: { id: string }) =>
          map.set(m.id, team.id)
        );
      });
    }
    return map;
  }, [shares, matches, selectedMatchId]);

  const teamScore = useMemo(() => {
    const scores = new Map<string, number>();
    liveEvents.forEach((ev) => {
      if (ev.type !== "goal") return;
      const resolvedTeam = memberTeamIdMap.get(ev.memberId || "");
      if (!resolvedTeam) return; // bỏ qua nếu không xác định được đội
      const teamId = resolvedTeam || "others";
      scores.set(teamId, (scores.get(teamId) || 0) + 1);
    });
    return scores;
  }, [liveEvents, memberTeamIdMap]);

  const displayTeams: [string, string][] = useMemo(() => {
    const named = Object.entries(currentTeamNames);
    if (named.length) return named;

    const fromShares = Array.from(
      new Set(shares.map((s) => s.teamId).filter(Boolean))
    ).map((id) => [
      id as string,
      shares.find((s) => s.teamId === id)?.teamName || `Đội ${id}`,
    ]);
    if (fromShares.length) return fromShares;

    const fromScores = Array.from(teamScore.keys()).map((id) => [
      id,
      `Đội ${id}`,
    ]);
    return fromScores;
  }, [currentTeamNames, shares, teamScore]);

  const liveStatsList = useMemo(() => {
    return Array.from(liveStatsMap.values())
      .map((stat) => ({
        ...stat,
        name: members.get(stat.memberId) || "Không rõ",
        teamName: memberTeamMap.get(stat.memberId) || "",
      }))
      .filter(
        (s) =>
          s.total > 0 || s.foul > 0 || s.yellow > 0 || s.red > 0 || s.note > 0
      )
      .sort((a, b) => {
        if (b.primaryScore !== a.primaryScore)
          return b.primaryScore - a.primaryScore;
        return b.total - a.total;
      });
  }, [liveStatsMap, members, memberTeamMap]);

  const topMedalScores = useMemo(() => {
    const uniqueScores = Array.from(
      new Set(liveStatsList.map((s) => s.primaryScore))
    );
    return uniqueScores.slice(0, 3);
  }, [liveStatsList]);

  const medalClassForScore = (score: number) => {
    if (topMedalScores[0] !== undefined && score === topMedalScores[0])
      return "gold";
    if (topMedalScores[1] !== undefined && score === topMedalScores[1])
      return "silver";
    if (topMedalScores[2] !== undefined && score === topMedalScores[2])
      return "bronze";
    return "";
  };

  const handleSaveWeights = async () => {
    try {
      await setDoc(doc(db, "configs", "scoringWeights"), actionWeights, {
        merge: true,
      });
      toast({
        title: "Đã lưu điểm quy đổi",
        description: "Các trang LiveNotes/Scoring/Matches sẽ dùng điểm mới.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu cấu hình điểm.",
      });
    }
  };

  const clampScore = (score: number) =>
    Math.max(0, Math.min(5, Number(score.toFixed(2))));

  const openDialog = (memberId: string) => {
    const existing = adminRatings.get(memberId);
    const liveStat = liveStatsMap.get(memberId);
    const suggested = liveStat ? clampScore(liveStat.primaryScore) : 0;
    setDialogTarget({
      memberId,
      name: members.get(memberId) || "Không rõ",
    });
    setAdminScoreInput(existing?.score ?? suggested);
    setAdminNotes(existing?.notes || "");
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!dialogTarget || !selectedMatchId) return;
    setIsSaving(true);
    try {
      const score = Math.max(0, Math.min(5, adminScoreInput));
      const ref = doc(
        db,
        "matches",
        selectedMatchId,
        "adminRatings",
        dialogTarget.memberId
      );
      await setDoc(
        ref,
        {
          score,
          notes: adminNotes.trim(),
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      toast({
        title: "Đã lưu",
        description: `Điểm admin cho ${dialogTarget.name} đã được cập nhật.`,
      });
      setIsDialogOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu điểm admin.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Chấm điểm admin</h1>
        <p className="text-muted-foreground">
          Giao diện riêng cho admin chấm điểm, không gồm các chức năng thanh
          toán.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Thiết lập điểm hành động</CardTitle>
              <CardDescription>
                Dùng chung cho Live Notes, ScoringMatches và modal Matches.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActionWeights(defaultActionWeights)}
              >
                Khôi phục mặc định
              </Button>
              <Button size="sm" onClick={handleSaveWeights}>
                Lưu cấu hình
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {([
              ["goal", "Bàn thắng"],
              ["assist", "Kiến tạo"],
              ["save_gk", "Cản phá GK"],
              ["tackle", "Tackle/Chặn"],
              ["dribble", "Qua người"],
              ["note", "Ghi chú khác"],
              ["yellow", "Thẻ vàng (-)"],
              ["red", "Thẻ đỏ (-)"],
              ["foul", "Phạm lỗi (-)"],
            ] as const).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`w-${key}`}>{label}</Label>
                <Input
                  id={`w-${key}`}
                  type="number"
                  step="0.1"
                  value={(actionWeights as any)[key]}
                  onChange={(e) =>
                    setActionWeights((prev) => ({
                      ...prev,
                      [key]: parseFloat(e.target.value || "0") || 0,
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-sm">Thêm action mới</h4>
              <span className="text-xs text-muted-foreground">
                Action custom chỉ áp dụng nếu Live Notes ghi nhận event cùng key.
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-5">
              <Input
                placeholder="Key (vd: press)"
                value={newAction.key}
                onChange={(e) =>
                  setNewAction((prev) => ({ ...prev, key: e.target.value }))
                }
              />
              <Input
                placeholder="Label"
                value={newAction.label}
                onChange={(e) =>
                  setNewAction((prev) => ({ ...prev, label: e.target.value }))
                }
              />
              <Input
                placeholder="Điểm"
                type="number"
                step="0.1"
                value={newAction.weight}
                onChange={(e) =>
                  setNewAction((prev) => ({ ...prev, weight: e.target.value }))
                }
              />
              <div className="flex items-center gap-2">
                <Input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={newAction.isNegative}
                  onChange={(e) =>
                    setNewAction((prev) => ({
                      ...prev,
                      isNegative: e.target.checked,
                    }))
                  }
                />
                <Label>Hành động trừ điểm</Label>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  if (!newAction.key.trim()) return;
                  setActionWeights((prev) => ({
                    ...prev,
                    extras: [
                      ...(prev.extras || []),
                      {
                        key: newAction.key.trim(),
                        label: newAction.label.trim() || newAction.key.trim(),
                        weight: parseFloat(newAction.weight || "0") || 0,
                        isNegative: newAction.isNegative,
                      },
                    ],
                  }));
                  setNewAction({
                    key: "",
                    label: "",
                    weight: "0.5",
                    isNegative: false,
                  });
                }}
              >
                Thêm
              </Button>
            </div>
            {(actionWeights.extras || []).length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold">Action đã thêm</div>
                <div className="flex flex-wrap gap-2">
                  {(actionWeights.extras || []).map((ex, idx) => (
                    <Badge key={ex.key + idx} variant="outline">
                      {ex.label || ex.key} ({ex.isNegative ? "-" : "+"}
                      {ex.weight})
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-2 h-6 w-6"
                        onClick={() =>
                          setActionWeights((prev) => ({
                            ...prev,
                            extras: (prev.extras || []).filter(
                              (_item, i) => i !== idx
                            ),
                          }))
                        }
                      >
                        ×
                      </Button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-4 shadow-card h-fit">
          <CardHeader>
            <CardTitle>Trận đấu</CardTitle>
            <CardDescription>
              Chọn trận để chấm điểm admin cho cầu thủ.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-2 space-y-1">
            {isLoading ? (
              <div className="p-4 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : matches.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Chưa có trận PUBLISHED/COMPLETED.
              </div>
            ) : (
              matches.map((match) => (
                <button
                  key={match.id}
                  onClick={() => setSelectedMatchId(match.id)}
                  className={cn(
                    "w-full text-left p-3 rounded-md transition-colors",
                    selectedMatchId === match.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  Trận ngày{" "}
                  {new Date(
                    typeof match.date === "string"
                      ? match.date
                      : match.date.toDate()
                  ).toLocaleDateString("vi-VN")}
                  <div className="text-xs opacity-80">
                    {match.status === "COMPLETED" ? "Đã tính tiền" : "Công khai"}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-8 shadow-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>Danh sách cầu thủ</CardTitle>
                <CardDescription>
                  Peer (/5) + Admin (/5) = Total (/10).
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm tên..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingMatchData ? (
              <div className="p-6 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border p-3 bg-muted/30">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-sm">
                      Thống kê nhanh (Live Notes)
                    </h4>
                    {isLoadingLiveStats && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {liveStatsList.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Chưa có sự kiện live cho trận này.
                    </p>
                  ) : (
                    <>
                      {Object.keys(currentTeamNames).length > 0 && (
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          {Object.entries(currentTeamNames)
                            .slice(0, 2)
                            .map(([teamId, teamName]) => (
                              <Card key={teamId} className="p-3 border-dashed">
                                <div className="text-sm font-semibold truncate">
                                  {teamName}
                                </div>
                                <div className="text-2xl font-black">
                                  {teamScore.get(teamId) || 0}
                                </div>
                              </Card>
                            ))}
                        </div>
                      )}
                    <div className="flex flex-wrap gap-2">
                      {liveStatsList.map((stats) => {
                        const medal = medalClassForScore(stats.primaryScore);
                        const medalIcon =
                          medal === "gold"
                            ? "🥇"
                            : medal === "silver"
                            ? "🥈"
                            : medal === "bronze"
                            ? "🥉"
                            : null;
                        const medalClass =
                          medal === "gold"
                            ? "border-emerald-400 bg-emerald-50"
                            : medal === "silver"
                            ? "border-blue-400 bg-blue-50"
                            : medal === "bronze"
                            ? "border-amber-400 bg-amber-50"
                            : "";
                        return (
                          <div
                            key={stats.memberId}
                            className={cn(
                              "rounded border p-2 bg-white text-xs space-y-1 w-[48%] sm:w-[31%] lg:w-[23%]",
                              medalClass
                            )}
                          >
                            <div className="flex items-center gap-1 font-semibold truncate">
                              {medalIcon && <span>{medalIcon}</span>}
                              <span className="truncate">{stats.name}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {stats.teamName || "Chưa rõ đội"}
                            </div>
                            <div className="flex flex-wrap gap-1 justify-start">
                              {stats.goal > 0 && (
                                <Badge className="bg-emerald-100 text-emerald-700">
                                  {(labelMap.get("goal") || "Bàn thắng") + " " + stats.goal}
                                </Badge>
                              )}
                              {stats.assist > 0 && (
                                <Badge className="bg-blue-100 text-blue-700">
                                  {(labelMap.get("assist") || "Kiến tạo") + " " + stats.assist}
                                </Badge>
                              )}
                              {stats.save_gk > 0 && (
                                <Badge className="bg-cyan-100 text-cyan-700">
                                  {(labelMap.get("save_gk") || "Cản phá GK") + " " + stats.save_gk}
                                </Badge>
                              )}
                              {stats.tackle > 0 && (
                                <Badge className="bg-indigo-100 text-indigo-700">
                                  {(labelMap.get("tackle") || "Tackle/Chặn") + " " + stats.tackle}
                                </Badge>
                              )}
                              {stats.dribble > 0 && (
                                <Badge className="bg-purple-100 text-purple-700">
                                  {(labelMap.get("dribble") || "Qua người") + " " + stats.dribble}
                                </Badge>
                              )}
                              {stats.yellow > 0 && (
                                <Badge className="bg-amber-100 text-amber-800">
                                  {(labelMap.get("yellow") || "Thẻ vàng") + " " + stats.yellow}
                                </Badge>
                              )}
                              {stats.red > 0 && (
                                <Badge className="bg-red-100 text-red-700">
                                  {(labelMap.get("red") || "Thẻ đỏ") + " " + stats.red}
                                </Badge>
                              )}
                              {stats.foul > 0 && (
                                <Badge className="bg-slate-100 text-slate-700">
                                  {(labelMap.get("foul") || "Phạm lỗi") + " " + stats.foul}
                                </Badge>
                              )}
                              {stats.note > 0 && (
                                <Badge variant="outline">
                                  {(labelMap.get("note") || "Ghi chú") + " " + stats.note}
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      </div>
                    </>
                  )}
                </div>

                {players.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Chưa có thành viên cho trận này.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Thành viên</TableHead>
                        <TableHead>Đội</TableHead>
                        <TableHead className="text-right">Peer /5</TableHead>
                        <TableHead className="text-right">Admin /5</TableHead>
                        <TableHead className="text-right">Total /10</TableHead>
                        <TableHead className="text-right">Hành động</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {players.map((player) => {
                        const peer = playerRatings.get(player.memberId);
                        const peerScore = peer?.averageScore || 0;
                        const admin = adminRatings.get(player.memberId);
                        const adminScore = admin?.score || 0;
                        const total = Math.min(peerScore + adminScore, 10);
                        return (
                          <TableRow key={player.memberId}>
                            <TableCell className="font-medium">
                              {members.get(player.memberId) || "Không rõ"}
                            </TableCell>
                            <TableCell>{player.teamName}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline">
                                {peer ? peerScore.toFixed(2) : "Chưa có"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {admin ? (
                                <Badge variant="secondary">
                                  {adminScore.toFixed(2)}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Chưa chấm
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {total.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDialog(player.memberId)}
                              >
                                <FilePenLine className="h-4 w-4 mr-1" />
                                {admin ? "Sửa" : "Chấm"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setDialogTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Chấm điểm admin cho {dialogTarget?.name || "thành viên"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {dialogTarget && liveStatsMap.get(dialogTarget.memberId) && (
              <div className="rounded-md border p-3 bg-muted/40 space-y-2 text-sm">
                {(() => {
                  const stat = liveStatsMap.get(dialogTarget.memberId)!;
                  const suggested = clampScore(stat.primaryScore);
                  const statBadges: { label: string; value: number }[] = [
                    { label: labelMap.get("goal") || "Bàn thắng", value: stat.goal },
                    { label: labelMap.get("assist") || "Kiến tạo", value: stat.assist },
                    { label: labelMap.get("save_gk") || "Cản phá GK", value: stat.save_gk },
                    { label: labelMap.get("tackle") || "Tackle/Chặn", value: stat.tackle },
                    { label: labelMap.get("dribble") || "Qua người", value: stat.dribble },
                    { label: labelMap.get("note") || "Ghi chú", value: stat.note },
                    { label: labelMap.get("yellow") || "Thẻ vàng", value: stat.yellow },
                    { label: labelMap.get("red") || "Thẻ đỏ", value: stat.red },
                    { label: labelMap.get("foul") || "Phạm lỗi", value: stat.foul },
                  ];
                  (actionWeights.extras || []).forEach((extra) => {
                    const count = (stat as any)[extra.key] || 0;
                    statBadges.push({
                      label: extra.label || extra.key,
                      value: count,
                    });
                  });
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Live Notes</span>
                        <Badge variant="outline">
                          Gợi ý: {suggested.toFixed(2)} / 5
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {statBadges
                          .filter((item) => item.value > 0)
                          .map((item) => (
                            <Badge key={item.label} variant="secondary">
                              {item.label}: {item.value}
                            </Badge>
                          ))}
                        {statBadges.every((i) => i.value === 0) && (
                          <span className="text-xs text-muted-foreground">
                            Không có sự kiện live.
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Điểm gợi ý dựa trên Live Notes (primary score) đã giới hạn trong 0-5.
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="admin-score">Điểm (0 - 5)</Label>
              <Input
                id="admin-score"
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={adminScoreInput}
                onChange={(e) =>
                  setAdminScoreInput(
                    Math.min(5, Math.max(0, parseFloat(e.target.value) || 0))
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Ghi chú nhanh</Label>
              <div className="flex flex-wrap gap-2">
                {quickNotes.map((item) => (
                  <Button
                    key={item.label}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setAdminScoreInput((prev) =>
                        Math.min(5, parseFloat((prev + item.delta).toFixed(2)))
                      );
                      setAdminNotes((prev) => {
                        const trimmed = prev.trim();
                        const bullet = `- ${item.label} (+${item.delta}đ)`;
                        return trimmed ? `${trimmed}\n${bullet}` : bullet;
                      });
                    }}
                  >
                    {item.label} (+{item.delta})
                  </Button>
                ))}
              </div>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={4}
                placeholder="Ghi chú (từng dòng là một gạch đầu dòng)..."
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Tổng điểm = peer (tối đa 5) + admin (tối đa 5), clamp 10.
            </p>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                "Lưu điểm admin"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ScoringMatches;
