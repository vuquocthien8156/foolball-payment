import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection,
  query,
  onSnapshot,
  orderBy,
  getDocs,
  getDoc,
  addDoc,
  doc,
  Timestamp,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ActionWeights,
  defaultActionWeights,
  aggregateLiveStats,
  AggregatedStat,
} from "@/lib/liveStats";
import { useActionConfigs } from "@/hooks/useActionConfigs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Clock, Undo2 } from "lucide-react";

interface Match {
  id: string;
  date: Timestamp | string;
  status: string;
  isDeleted?: boolean;
  teamsConfig?: {
    id: string;
    name: string;
    members?: { id: string }[];
  }[];
}

interface Member {
  id: string;
  name: string;
}

interface LiveEvent {
  id: string;
  memberId: string;
  type:
    | "goal"
    | "assist"
    | "yellow"
    | "red"
    | "foul"
    | "save_gk"
    | "tackle"
    | "dribble"
    | "note";
  note?: string;
  minute?: number | null;
  second?: number | null;
}

const LiveNotes = () => {
  const {
    okActions,
    badActions,
    labelMap,
    weights,
    loading: actionsLoading,
  } = useActionConfigs();
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string>("");
  const [membersMap, setMembersMap] = useState<Map<string, string>>(new Map());
  const [attendanceMembers, setAttendanceMembers] = useState<
    { id: string; name: string; teamId?: string }[]
  >([]);
  const [teamsConfig, setTeamsConfig] = useState<
    { id: string; name: string; members?: { id: string }[] }[]
  >([]);
  const [memberOrder, setMemberOrder] = useState<Map<string, number>>(
    new Map()
  );
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveSearch, setLiveSearch] = useState("");
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [startTimestamp, setStartTimestamp] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const memberTeamMap = useMemo(
    () => new Map(attendanceMembers.map((m) => [m.id, m.teamId])),
    [attendanceMembers]
  );
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [showRecentMobile, setShowRecentMobile] = useState(false);
  const [showRecentEventsModal, setShowRecentEventsModal] = useState(false);
  const [actionWeights, setActionWeights] =
    useState<ActionWeights>(defaultActionWeights);
  const labelFor = useCallback(
    (key: string) =>
      labelMap.get(key) ||
      {
        goal: "Bàn thắng",
        assist: "Kiến tạo",
        save_gk: "Cản phá GK",
        tackle: "Tackle/Chặn",
        dribble: "Qua người",
        note: "Ghi chú",
        yellow: "Thẻ vàng",
        red: "Thẻ đỏ",
        foul: "Phạm lỗi",
      }[key] ||
      key,
    [labelMap]
  );

  const eventStats = useMemo(() => {
    const map = aggregateLiveStats(
      liveEvents.map((ev) => ({ memberId: ev.memberId, type: ev.type })),
      actionWeights
    );
    const withNames = new Map<string, AggregatedStat & { name: string }>();
    map.forEach((stat, memberId) => {
      withNames.set(memberId, {
        ...stat,
        name: membersMap.get(memberId) || "Không rõ",
      });
    });
    return withNames;
  }, [liveEvents, membersMap, actionWeights]);

  const sortedStats = useMemo(() => {
    const arr = Array.from(eventStats.entries()).map(([memberId, stats]) => ({
      memberId,
      ...stats,
      primaryScore: stats.primaryScore,
    }));
    return arr
      .filter(
        (s) =>
          s.total > 0 || s.foul > 0 || s.yellow > 0 || s.red > 0 || s.note > 0
      )
      .sort((a, b) => {
        if (b.primaryScore !== a.primaryScore)
          return b.primaryScore - a.primaryScore;
        return b.total - a.total;
      });
  }, [eventStats]);

  const topMedalScores = useMemo(() => {
    const uniqueScores = Array.from(
      new Set(sortedStats.map((s) => s.primaryScore))
    );
    return uniqueScores.slice(0, 3);
  }, [sortedStats]);

  const medalClassForScore = (score: number) => {
    if (topMedalScores[0] !== undefined && score === topMedalScores[0])
      return "gold";
    if (topMedalScores[1] !== undefined && score === topMedalScores[1])
      return "silver";
    if (topMedalScores[2] !== undefined && score === topMedalScores[2])
      return "bronze";
    return "";
  };

  useEffect(() => {
    const fetchMatches = async () => {
      setIsLoadingMatches(true);
      try {
        const q = query(collection(db, "matches"), orderBy("date", "desc"));
        const snap = await getDocs(q);
        const candidates = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Match))
          .filter((m) => m.status === "PUBLISHED" && !m.isDeleted);

        const withPaymentInfo = await Promise.all(
          candidates.map(async (m) => {
            const sharesSnap = await getDocs(
              collection(db, "matches", m.id, "shares")
            );
            const totalShares = sharesSnap.size;
            let paidCount = 0;
            sharesSnap.forEach((s) => {
              if ((s.data() as any).status === "PAID") paidCount++;
            });
            const isFullyPaid = totalShares > 0 && paidCount === totalShares;
            return { match: m, isFullyPaid };
          })
        );

        const list = withPaymentInfo
          .filter((item) => !item.isFullyPaid)
          .map((item) => item.match);

        setMatches(list);
        if (list.length > 0) {
          setSelectedMatchId(list[0].id);
        } else {
          setSelectedMatchId("");
        }
      } catch (error) {
        console.error("Failed to load matches for Live Notes", error);
        toast({
          variant: "destructive",
          title: "Lỗi tải trận",
          description: "Không tải được danh sách trận công khai.",
        });
        setMatches([]);
        setSelectedMatchId("");
      } finally {
        setIsLoadingMatches(false);
      }
    };
    fetchMatches();
  }, []);

  useEffect(() => {
    const fetchMembers = async () => {
      const snap = await getDocs(collection(db, "members"));
      const map = new Map(
        snap.docs.map((d) => [d.id, d.data().name as string])
      );
      setMembersMap(map);
    };
    fetchMembers();
  }, []);

  useEffect(() => {
    if (!selectedMatchId) {
      setAttendanceMembers([]);
      setLiveEvents([]);
      setTeamsConfig([]);
      setMemberOrder(new Map());
      return;
    }
    const fetchMatchConfig = async () => {
      try {
        const matchSnap = await getDoc(doc(db, "matches", selectedMatchId));
        if (matchSnap.exists()) {
          const data = matchSnap.data() as Match;
          const teams = data.teamsConfig || [];
          setTeamsConfig(teams);
          const orderMap = new Map<string, number>();
          teams.forEach((team) => {
            (team.members || []).forEach((m, idx) => orderMap.set(m.id, idx));
          });
          setMemberOrder(orderMap);
        } else {
          setTeamsConfig([]);
          setMemberOrder(new Map());
        }
      } catch (err) {
        console.error("Error fetching match config", err);
        setTeamsConfig([]);
        setMemberOrder(new Map());
      }
    };
    fetchMatchConfig();
  }, [selectedMatchId]);

  useEffect(() => {
    if (!actionsLoading) {
      setActionWeights(weights);
    }
  }, [actionsLoading, weights]);

  useEffect(() => {
    if (!selectedMatchId) return;
    const attendanceRef = collection(
      db,
      "matches",
      selectedMatchId,
      "attendance"
    );
    const unsubscribeAttendance = onSnapshot(attendanceRef, (snapshot) => {
      const list: { id: string; name: string; teamId?: string }[] = [];
      snapshot.forEach((docSnap) => {
        const foundTeamId =
          (docSnap.data() as any)?.teamId ||
          teamsConfig.find((t) =>
            (t.members || []).some((m) => m.id === docSnap.id)
          )?.id;
        list.push({
          id: docSnap.id,
          name:
            membersMap.get(docSnap.id) ||
            (docSnap.data() as any)?.memberName ||
            "Không rõ",
          teamId: foundTeamId,
        });
      });
      setAttendanceMembers(list);
    });
    return () => unsubscribeAttendance();
  }, [selectedMatchId, membersMap, teamsConfig]);

  useEffect(() => {
    if (!selectedMatchId) return;
    const eventsQuery = query(
      collection(db, "matches", selectedMatchId, "liveEvents"),
      orderBy("createdAt", "desc")
    );
    const unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
      const list = snapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() } as LiveEvent)
      );
      setLiveEvents(list);
    });
    return () => unsubscribeEvents();
  }, [selectedMatchId]);

  useEffect(() => {
    let interval: number | undefined;
    if (isTimerRunning && startTimestamp) {
      interval = window.setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimestamp) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, [isTimerRunning, startTimestamp]);

  // Wake Lock API to prevent screen sleep during match
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
          console.log("Wake Lock activated");

          wakeLock.addEventListener("release", () => {
            console.log("Wake Lock released");
          });
        }
      } catch (err) {
        console.error("Wake Lock request failed:", err);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLock) {
        try {
          await wakeLock.release();
          wakeLock = null;
        } catch (err) {
          console.error("Wake Lock release failed:", err);
        }
      }
    };

    if (isTimerRunning) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => {
      releaseWakeLock();
    };
  }, [isTimerRunning]);

  const formatTime = (seconds: number) => {
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const handleStartTimer = () => {
    setStartTimestamp(Date.now());
    setElapsedSeconds(0);
    setIsTimerRunning(true);
  };
  const handleStopTimer = () => setIsTimerRunning(false);

  const filteredMembers = useMemo(() => {
    const term = liveSearch.toLowerCase();
    return attendanceMembers.filter((m) => m.name.toLowerCase().includes(term));
  }, [attendanceMembers, liveSearch]);

  const groupedByTeam = useMemo(() => {
    if (teamsConfig.length === 0) {
      return [{ id: "others", name: "Tất cả", members: filteredMembers }];
    }
    const groups = teamsConfig.map((team) => {
      const membersInTeam = filteredMembers
        .filter((m) => m.teamId === team.id)
        .sort(
          (a, b) =>
            (memberOrder.get(a.id) ?? 999) - (memberOrder.get(b.id) ?? 999)
        );
      return {
        id: team.id,
        name: team.name,
        members: membersInTeam,
      };
    });
    const others = filteredMembers.filter(
      (m) => !teamsConfig.some((t) => t.id === m.teamId)
    );
    if (others.length > 0) {
      groups.push({ id: "others", name: "Khác", members: others });
    }
    return groups;
  }, [filteredMembers, teamsConfig, memberOrder]);

  const teamScore = useMemo(() => {
    const map = new Map<string, number>();
    liveEvents.forEach((ev) => {
      if (ev.type !== "goal") return;
      const teamId = memberTeamMap.get(ev.memberId) || "others";
      map.set(teamId, (map.get(teamId) || 0) + 1);
    });
    return map;
  }, [liveEvents, memberTeamMap]);

  const renderMemberChip = (m: { id: string; name: string }) => {
    const stats = eventStats.get(m.id);
    const hasEvents =
      stats &&
      (stats.total > 0 || stats.foul > 0 || stats.yellow > 0 || stats.red > 0);

    return (
      <button
        key={m.id}
        className={cn(
          "relative flex flex-col items-start gap-1 p-3 rounded-lg border-2 transition-all",
          "active:scale-95 touch-manipulation min-h-[70px] min-w-[140px] flex-shrink-0",
          selectedMemberId === m.id
            ? "border-primary bg-primary/10 shadow-md"
            : "border-border bg-card hover:border-primary/50 hover:bg-accent"
        )}
        onClick={() => setSelectedMemberId(m.id)}
      >
        <span
          className={cn(
            "font-semibold text-base leading-tight",
            selectedMemberId === m.id ? "text-primary" : "text-foreground"
          )}
        >
          {m.name}
        </span>
        {hasEvents && (
          <div className="flex flex-wrap gap-1">
            {stats.goal > 0 && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs bg-emerald-100 text-emerald-700"
              >
                ⚽ {stats.goal}
              </Badge>
            )}
            {stats.assist > 0 && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs bg-blue-100 text-blue-700"
              >
                🅰️ {stats.assist}
              </Badge>
            )}
            {stats.yellow > 0 && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs bg-amber-100 text-amber-800"
              >
                🟨 {stats.yellow}
              </Badge>
            )}
            {stats.red > 0 && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs bg-red-100 text-red-700"
              >
                🟥 {stats.red}
              </Badge>
            )}
          </div>
        )}
        {selectedMemberId === m.id && (
          <div className="absolute top-1 right-1">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          </div>
        )}
      </button>
    );
  };

  const handleAddLiveEvent = async (
    memberId: string | undefined,
    type: LiveEvent["type"],
    note?: string
  ) => {
    const targetId = memberId || selectedMemberId;
    if (!selectedMatchId || !targetId) {
      toast({
        variant: "destructive",
        title: "Chọn cầu thủ",
        description: "Chọn thành viên để ghi sự kiện.",
      });
      return;
    }
    try {
      const minute =
        startTimestamp && isTimerRunning
          ? Math.floor((Date.now() - startTimestamp) / 1000 / 60)
          : null;
      const second =
        startTimestamp && isTimerRunning
          ? Math.floor((Date.now() - startTimestamp) / 1000) % 60
          : null;
      await addDoc(collection(db, "matches", selectedMatchId, "liveEvents"), {
        memberId: targetId,
        type,
        note: note || null,
        minute,
        second,
        createdAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Error adding live event:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể ghi sự kiện.",
      });
    }
  };

  const handleAddNote = (memberId: string) => {
    const note = window.prompt("Nhập ghi chú");
    if (!note) return;
    handleAddLiveEvent(memberId, "note", note);
  };

  const handleUndoEvent = async (eventId: string) => {
    if (!selectedMatchId) return;
    try {
      await deleteDoc(
        doc(db, "matches", selectedMatchId, "liveEvents", eventId)
      );
      toast({ title: "Đã hoàn tác sự kiện" });
    } catch (error) {
      console.error("Error undo event:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể hoàn tác sự kiện.",
      });
    }
  };

  const liveTypeLabel: Record<LiveEvent["type"], string> = {
    goal: "Bàn thắng",
    assist: "Kiến tạo",
    yellow: "Thẻ vàng",
    red: "Thẻ đỏ",
    foul: "Phạm lỗi",
    save_gk: "Cản phá GK",
    tackle: "Tackle/Chặn",
    dribble: "Qua người",
    note: "Ghi chú khác",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Ghi chú live</h1>
            <p className="text-muted-foreground">
              Trang dành cho admin ghi sự kiện nhanh trong trận công khai.
            </p>
          </div>
        </div>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Trận hiện tại</CardTitle>
            <CardDescription>
              Tự động chọn trận public mới nhất chưa thanh toán xong.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-row gap-4 items-center">
            {isLoadingMatches ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tải...
              </div>
            ) : matches.length === 0 || !selectedMatchId ? (
              <p className="text-sm text-muted-foreground">
                Không có trận Public khả dụng.
              </p>
            ) : (
              <div className="flex flex-col">
                <span className="font-semibold">
                  Trận ngày{" "}
                  {new Date(
                    typeof matches[0].date === "string"
                      ? matches[0].date
                      : matches[0].date.toDate()
                  ).toLocaleDateString("vi-VN")}
                </span>
                <span className="text-xs text-muted-foreground">
                  Đang ghi chú cho trận gần nhất.
                </span>
              </div>
            )}

            {isTimerRunning ? (
              <Button variant="outline" onClick={handleStopTimer} size="sm">
                Dừng
              </Button>
            ) : (
              <Button onClick={handleStartTimer} size="sm">
                Bắt đầu trận
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Recent Events - Hidden on mobile to prevent layout issues */}
        <Card className="shadow-card hidden">
          <CardHeader>
            <CardTitle>Sự kiện gần đây</CardTitle>
            <CardDescription>Hiển thị trên mobile/tablet.</CardDescription>
          </CardHeader>
          <CardContent>
            {liveEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có sự kiện.</p>
            ) : (
              <div className="space-y-2 max-h-[360px] overflow-y-auto">
                {liveEvents.slice(0, 20).map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-md border bg-muted/40"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold">
                        {liveTypeLabel[ev.type]}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {ev.minute !== null && ev.minute !== undefined
                          ? `${ev.minute}'${
                              ev.second !== null && ev.second !== undefined
                                ? `:${String(ev.second).padStart(2, "0")}`
                                : ""
                            }`
                          : "--:--"}
                      </span>
                    </div>
                    <div className="text-sm">
                      {membersMap.get(ev.memberId) || ev.memberId}
                    </div>
                    {ev.note && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {ev.note}
                      </p>
                    )}
                    <div className="mt-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-muted-foreground h-7 px-2"
                        onClick={() => handleUndoEvent(ev.id)}
                      >
                        <Undo2 className="h-3 w-3 mr-1" />
                        Hoàn tác
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>Thống kê nhanh</CardTitle>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-2">
                <Clock className="h-5 w-5" />
                <span className="text-2xl font-black tabular-nums">
                  {formatTime(elapsedSeconds)}
                </span>
              </div>
            </div>
            {teamsConfig.length >= 2 && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                {teamsConfig.slice(0, 2).map((team) => (
                  <Card key={team.id} className="p-3 border-dashed">
                    <div className="text-base font-semibold">{team.name}</div>
                    <div className="text-3xl font-black">
                      {teamScore.get(team.id) || 0}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {sortedStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có thống kê.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedStats.map((stats) => {
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
                        "rounded border p-2 bg-muted/20 text-xs space-y-1 w-[48%] sm:w-[31%] lg:w-[23%]",
                        medalClass
                      )}
                    >
                      <div className="flex items-center gap-1 font-semibold truncate">
                        {medalIcon && <span>{medalIcon}</span>}
                        <span className="truncate">{stats.name}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-start">
                        {stats.goal > 0 && (
                          <Badge className="bg-emerald-100 text-emerald-700 cursor-default">
                            {labelFor("goal")} {stats.goal}
                          </Badge>
                        )}
                        {stats.assist > 0 && (
                          <Badge className="bg-blue-100 text-blue-700 cursor-default">
                            {labelFor("assist")} {stats.assist}
                          </Badge>
                        )}
                        {stats.save_gk > 0 && (
                          <Badge className="bg-cyan-100 text-cyan-700 cursor-default">
                            {labelFor("save_gk")} {stats.save_gk}
                          </Badge>
                        )}
                        {stats.tackle > 0 && (
                          <Badge className="bg-indigo-100 text-indigo-700 cursor-default">
                            {labelFor("tackle")} {stats.tackle}
                          </Badge>
                        )}
                        {stats.dribble > 0 && (
                          <Badge className="bg-purple-100 text-purple-700 cursor-default">
                            {labelFor("dribble")} {stats.dribble}
                          </Badge>
                        )}
                        {stats.yellow > 0 && (
                          <Badge className="bg-amber-100 text-amber-800 cursor-default">
                            {labelFor("yellow")} {stats.yellow}
                          </Badge>
                        )}
                        {stats.red > 0 && (
                          <Badge className="bg-red-100 text-red-700 cursor-default">
                            {labelFor("red")} {stats.red}
                          </Badge>
                        )}
                        {stats.foul > 0 && (
                          <Badge className="bg-slate-100 text-slate-700 cursor-default">
                            {labelFor("foul")} {stats.foul}
                          </Badge>
                        )}
                        {stats.note > 0 && (
                          <Badge variant="outline" className="cursor-default">
                            {labelFor("note")} {stats.note}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Ghi sự kiện</CardTitle>
                <CardDescription>
                  Chọn cầu thủ từ danh sách đã điểm danh và bấm nút sự kiện.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden shrink-0"
                onClick={() => setShowRecentEventsModal(true)}
              >
                📋 Sự kiện
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 lg:flex-row">
            <div className="lg:flex-1 space-y-4">
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Tìm thành viên..."
                  value={liveSearch}
                  onChange={(e) => setLiveSearch(e.target.value)}
                  className="w-full"
                />
                <Badge variant="outline">{filteredMembers.length} người</Badge>
              </div>
              <div className="space-y-2 sticky top-2 bg-background/80 backdrop-blur border rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold">Hành động nhanh</h4>
                  {selectedMemberId && (
                    <Badge variant="secondary">
                      Đang chọn:{" "}
                      {membersMap.get(selectedMemberId) || selectedMemberId}
                    </Badge>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-emerald-600">
                      OK
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(okActions || []).map((action) => (
                        <Button
                          key={action.key}
                          size="sm"
                          className={cn(
                            "h-8 px-3 text-xs",
                            action.color || "bg-emerald-100 text-emerald-700"
                          )}
                          variant="secondary"
                          onClick={() =>
                            handleAddLiveEvent(
                              selectedMemberId,
                              action.key as any
                            )
                          }
                          disabled={!selectedMemberId || actionsLoading}
                        >
                          {action.label}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAddNote(selectedMemberId || "")}
                        disabled={!selectedMemberId}
                      >
                        Ghi chú khác
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-red-600">
                      Không OK
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(badActions || []).map((action) => (
                        <Button
                          key={action.key}
                          size="sm"
                          variant="outline"
                          className={cn(
                            "h-8 px-3 text-xs",
                            action.color ||
                              (action.key === "red"
                                ? "border-red-500 text-red-700"
                                : action.key === "yellow"
                                ? "border-amber-500 text-amber-800"
                                : "border-slate-400 text-slate-700")
                          )}
                          onClick={() =>
                            handleAddLiveEvent(
                              selectedMemberId,
                              action.key as any
                            )
                          }
                          disabled={!selectedMemberId || actionsLoading}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {filteredMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có ai điểm danh hoặc không tìm thấy.
                </p>
              ) : teamsConfig.length >= 2 ? (
                <div className="space-y-4">
                  {groupedByTeam.slice(0, 2).map((group) => (
                    <div key={group.id} className="space-y-2">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <span>{group.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {group.members.length}
                        </Badge>
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {group.members.map((m) => renderMemberChip(m))}
                      </div>
                    </div>
                  ))}
                  {groupedByTeam.slice(2).length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <span>Khác</span>
                        <Badge variant="outline" className="text-xs">
                          {groupedByTeam
                            .slice(2)
                            .reduce((acc, g) => acc + g.members.length, 0)}
                        </Badge>
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {groupedByTeam
                          .slice(2)
                          .flatMap((g) => g.members)
                          .map((m) => renderMemberChip(m))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groupedByTeam.flatMap((g) =>
                    g.members.map((m) => renderMemberChip(m))
                  )}
                </div>
              )}
            </div>
            <div className="space-y-3 lg:w-[250px] hidden lg:block">
              <h4 className="font-semibold">Sự kiện gần đây</h4>
              {liveEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có sự kiện.
                </p>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto">
                  {liveEvents.slice(0, 20).map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-md border bg-muted/40"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold">
                          {liveTypeLabel[ev.type]}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {ev.minute !== null && ev.minute !== undefined
                            ? `${ev.minute}'${
                                ev.second !== null && ev.second !== undefined
                                  ? `:${String(ev.second).padStart(2, "0")}`
                                  : ""
                              }`
                            : "--:--"}
                        </span>
                      </div>
                      <div className="text-sm">
                        {membersMap.get(ev.memberId) || ev.memberId}
                      </div>
                      {ev.note && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {ev.note}
                        </p>
                      )}
                      <div className="mt-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-muted-foreground h-7 px-2"
                          onClick={() => handleUndoEvent(ev.id)}
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          Hoàn tác
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Events Modal for Mobile/Tablet */}
        <Dialog
          open={showRecentEventsModal}
          onOpenChange={setShowRecentEventsModal}
        >
          <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Sự kiện gần đây</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
              {liveEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Chưa có sự kiện.
                </p>
              ) : (
                <div className="space-y-2">
                  {liveEvents.slice(0, 20).map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-md border bg-muted/40"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold">
                          {liveTypeLabel[ev.type]}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {ev.minute !== null && ev.minute !== undefined
                            ? `${ev.minute}'${
                                ev.second !== null && ev.second !== undefined
                                  ? `:${String(ev.second).padStart(2, "0")}`
                                  : ""
                              }`
                            : "--:--"}
                        </span>
                      </div>
                      <div className="text-sm">
                        {membersMap.get(ev.memberId) || ev.memberId}
                      </div>
                      {ev.note && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {ev.note}
                        </p>
                      )}
                      <div className="mt-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-muted-foreground h-7 px-2"
                          onClick={() => handleUndoEvent(ev.id)}
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          Hoàn tác
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default LiveNotes;
