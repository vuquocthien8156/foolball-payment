import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import {
  MemberEloStats,
  GroupEloSnapshot,
  TIER_CONFIG,
  EloTier
} from "@/lib/elo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Trophy,
  ArrowLeft,
  Flame,
  Search,
  History,
  TrendingUp,
  Award,
  Sparkles,
  Zap,
  Target,
  ShieldAlert,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

const PublicElo: React.FC = () => {
  const { groupId, group } = useGroup();
  const groupPath = useGroupPath();
  const [snapshot, setSnapshot] = useState<GroupEloSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"elo" | "winRate" | "matches">("elo");
  const [selectedMember, setSelectedMember] = useState<MemberEloStats | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);

    const statsRef = doc(db, "groups", groupId, "stats", "elo");
    const unsubscribe = onSnapshot(
      statsRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setSnapshot(docSnap.data() as GroupEloSnapshot);
          setLoading(false);
        } else {
          loadFromMembersCollection();
        }
      },
      (error) => {
        console.warn("Snapshot subscription notice:", error.message);
        loadFromMembersCollection();
      }
    );

    const loadFromMembersCollection = async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "members"), where("groupId", "==", groupId))
        );
        const membersList: MemberEloStats[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              memberId: d.id,
              name: data.name || "Cầu thủ",
              nickname: data.nickname || "",
              avatarUrl: data.avatarUrl,
              inactive: !!data.inactive,
              elo: typeof data.elo === "number" ? data.elo : 1000,
              rank: data.eloRank || 0,
              tier: data.eloTier || "silver",
              matchesPlayed: data.matchesPlayed || 0,
              wins: data.wins || 0,
              draws: data.draws || 0,
              losses: data.losses || 0,
              winRate: data.winRate || 0,
              recentForm: data.recentForm || [],
              lastDelta: data.lastDelta || 0,
              history: data.eloHistory || []
            } as MemberEloStats;
          })
          .filter((m) => !m.inactive)
          .sort((a, b) => b.elo - a.elo);

        membersList.forEach((m, idx) => {
          m.rank = idx + 1;
        });

        setSnapshot({
          groupId,
          updatedAt: new Date().toISOString(),
          totalMatchesProcessed: 0,
          rankings: membersList
        });
      } catch (err) {
        console.error("Error loading members for Elo:", err);
      } finally {
        setLoading(false);
      }
    };

    return () => unsubscribe();
  }, [groupId]);

  const rawRankings = useMemo(() => snapshot?.rankings || [], [snapshot]);

  // Highlight Stats
  const topPlayer = useMemo(() => rawRankings[0] || null, [rawRankings]);
  const bestWinratePlayer = useMemo(() => {
    const qualified = rawRankings.filter((m) => m.matchesPlayed >= 5);
    if (qualified.length === 0) return null;
    return [...qualified].sort((a, b) => b.winRate - a.winRate)[0];
  }, [rawRankings]);

  const hotStreakPlayer = useMemo(() => {
    const withWins = rawRankings.filter((m) => m.recentForm.length >= 3);
    if (withWins.length === 0) return null;
    return [...withWins].sort((a, b) => {
      const aWins = a.recentForm.filter((f) => f === "W").length;
      const bWins = b.recentForm.filter((f) => f === "W").length;
      return bWins - aWins;
    })[0];
  }, [rawRankings]);

  // Filter and Sort
  const processedRankings = useMemo(() => {
    let list = [...rawRankings];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.nickname && m.nickname.toLowerCase().includes(q))
      );
    }

    if (selectedTier !== "all") {
      list = list.filter((m) => m.tier === selectedTier);
    }

    if (sortBy === "winRate") {
      list.sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.elo - a.elo;
      });
    } else if (sortBy === "matches") {
      list.sort((a, b) => {
        if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
        return b.elo - a.elo;
      });
    } else {
      list.sort((a, b) => b.elo - a.elo);
    }

    return list;
  }, [rawRankings, searchQuery, selectedTier, sortBy]);

  const handleOpenMember = (member: MemberEloStats) => {
    setSelectedMember(member);
    setIsModalOpen(true);
  };

  const renderFormBadge = (formChar: "W" | "D" | "L", idx: number) => {
    const isW = formChar === "W";
    const isD = formChar === "D";
    return (
      <span
        key={idx}
        title={isW ? "Thắng" : isD ? "Hòa" : "Thua"}
        className={cn(
          "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shadow-xs",
          isW && "bg-emerald-500 text-white",
          isD && "bg-amber-500 text-white",
          !isW && !isD && "bg-rose-500 text-white"
        )}
      >
        {isW ? "W" : isD ? "D" : "L"}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/20 to-background pb-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 space-y-6">
        {/* Navigation Back */}
        <div className="flex items-center justify-between">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1.5 -ml-2"
          >
            <Link to={groupPath("public")}>
              <ArrowLeft className="h-4 w-4" />
              <span>Quay lại trang chính</span>
            </Link>
          </Button>

          <Badge variant="outline" className="text-xs py-1 px-2.5 bg-background shadow-xs">
            {group?.name || "Bóng đá"}
          </Badge>
        </div>

        {/* Hero Header */}
        <div className="text-center space-y-3 py-2">
          <div className="inline-flex p-3 bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-400 rounded-2xl shadow-lg text-white">
            <Trophy className="h-9 w-9" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Bảng Xếp Hạng ELO
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto">
            Hệ thống tính điểm ELO tự động dựa trên kết quả Thắng, Thua, Hoà của từng trận đấu bóng đá.
          </p>
        </div>

        {/* Highlights Row */}
        {!loading && rawRankings.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Top 1 */}
            {topPlayer && (
              <Card
                onClick={() => handleOpenMember(topPlayer)}
                className="cursor-pointer bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/30 hover:border-amber-500/60 transition-all shadow-sm"
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-300">
                    <CrownIcon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold">
                      Quán quân ELO
                    </p>
                    <p className="font-bold text-base text-foreground truncate">
                      {topPlayer.name}
                    </p>
                    <p className="text-xs font-black text-amber-600">
                      {topPlayer.elo} ELO ({topPlayer.winRate}% WR)
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Best Winrate */}
            {bestWinratePlayer && (
              <Card
                onClick={() => handleOpenMember(bestWinratePlayer)}
                className="cursor-pointer bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/30 hover:border-emerald-500/60 transition-all shadow-sm"
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                    <Target className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                      Tỉ lệ thắng cao nhất
                    </p>
                    <p className="font-bold text-base text-foreground truncate">
                      {bestWinratePlayer.name}
                    </p>
                    <p className="text-xs font-black text-emerald-600">
                      {bestWinratePlayer.winRate}% ({bestWinratePlayer.wins}/{bestWinratePlayer.matchesPlayed} trận)
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Hot Streak */}
            {hotStreakPlayer && (
              <Card
                onClick={() => handleOpenMember(hotStreakPlayer)}
                className="cursor-pointer bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/30 hover:border-rose-500/60 transition-all shadow-sm"
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-600 dark:text-rose-300">
                    <Flame className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-rose-700 dark:text-rose-400 font-semibold">
                      Phong độ rực cháy
                    </p>
                    <p className="font-bold text-base text-foreground truncate">
                      {hotStreakPlayer.name}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {hotStreakPlayer.recentForm.slice(-4).map((f, i) => renderFormBadge(f, i))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm cầu thủ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10 bg-background"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            {/* Tier Filters */}
            <div className="flex items-center bg-muted/60 p-1 rounded-lg border text-xs shrink-0">
              <button
                onClick={() => setSelectedTier("all")}
                className={cn(
                  "px-2.5 py-1 rounded-md font-medium transition-all",
                  selectedTier === "all" ? "bg-background text-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Tất cả ({rawRankings.length})
              </button>
              {(["master", "diamond", "gold", "silver"] as EloTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTier(t)}
                  className={cn(
                    "px-2 py-1 rounded-md font-medium transition-all",
                    selectedTier === t ? "bg-background text-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {TIER_CONFIG[t].icon} {TIER_CONFIG[t].label}
                </button>
              ))}
            </div>

            {/* Sort Toggle */}
            <div className="flex items-center bg-muted/60 p-1 rounded-lg border text-xs shrink-0">
              <button
                onClick={() => setSortBy("elo")}
                className={cn(
                  "px-2.5 py-1 rounded-md font-medium transition-all",
                  sortBy === "elo" ? "bg-background text-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                ELO
              </button>
              <button
                onClick={() => setSortBy("winRate")}
                className={cn(
                  "px-2.5 py-1 rounded-md font-medium transition-all",
                  sortBy === "winRate" ? "bg-background text-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                % Thắng
              </button>
              <button
                onClick={() => setSortBy("matches")}
                className={cn(
                  "px-2.5 py-1 rounded-md font-medium transition-all",
                  sortBy === "matches" ? "bg-background text-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Số trận
              </button>
            </div>
          </div>
        </div>

        {/* Full Leaderboard Card */}
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Xếp hạng thành viên</CardTitle>
                <CardDescription className="text-xs">
                  Hiển thị {processedRankings.length} cầu thủ đang hoạt động
                </CardDescription>
              </div>

              {snapshot?.totalMatchesProcessed ? (
                <Badge variant="outline" className="text-xs font-normal">
                  Đã đồng bộ {snapshot.totalMatchesProcessed} trận
                </Badge>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="py-16 text-center text-muted-foreground space-y-2">
                <Sparkles className="h-6 w-6 animate-spin mx-auto text-amber-500" />
                <p className="text-sm">Đang tải dữ liệu xếp hạng...</p>
              </div>
            ) : processedRankings.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <p className="text-sm">Không tìm thấy cầu thủ nào phù hợp.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {processedRankings.map((member) => {
                  const tier = TIER_CONFIG[member.tier] || TIER_CONFIG.silver;
                  return (
                    <div
                      key={member.memberId}
                      onClick={() => handleOpenMember(member)}
                      className="p-3.5 sm:px-5 flex items-center justify-between gap-3 hover:bg-muted/40 cursor-pointer transition-colors"
                    >
                      {/* Left: Rank, Avatar & Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            "w-7 text-center font-extrabold text-sm sm:text-base",
                            member.rank === 1 && "text-amber-500 font-black",
                            member.rank === 2 && "text-slate-500 font-black",
                            member.rank === 3 && "text-amber-700 font-black",
                            member.rank > 3 && "text-muted-foreground font-bold"
                          )}
                        >
                          #{member.rank}
                        </span>

                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-muted-foreground/20 to-muted flex items-center justify-center font-bold text-sm text-foreground shrink-0 shadow-inner">
                          {member.name.charAt(0)}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm sm:text-base text-foreground truncate">
                              {member.name}
                            </span>
                            {member.nickname && (
                              <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                                ({member.nickname})
                              </span>
                            )}
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1.5 py-0 h-4 font-normal",
                                tier.bgBadge
                              )}
                            >
                              {tier.label}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span>{member.matchesPlayed} trận</span>
                            <span>•</span>
                            <span className="text-emerald-600 font-semibold">{member.wins}T</span>
                            <span>{member.draws}H</span>
                            <span className="text-rose-500">{member.losses}B</span>
                            <span>•</span>
                            <span className="font-medium text-foreground">{member.winRate}% WR</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Elo, Last Delta & Form */}
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="hidden md:flex items-center gap-1">
                          {member.recentForm.slice(-5).map((f, i) => renderFormBadge(f, i))}
                        </div>

                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-black text-lg text-foreground">
                              {member.elo}
                            </span>
                            {member.lastDelta !== undefined && member.lastDelta !== 0 && (
                              <span
                                className={cn(
                                  "text-xs font-bold px-1.5 py-0.5 rounded",
                                  member.lastDelta > 0
                                    ? "text-emerald-700 bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300"
                                    : "text-rose-700 bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300"
                                )}
                              >
                                {member.lastDelta > 0 ? `+${member.lastDelta}` : member.lastDelta}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground font-medium">ĐIỂM ELO</p>
                        </div>

                        <ChevronRight className="h-4 w-4 text-muted-foreground/60 hidden sm:block" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* DETAILED PLAYER MODAL */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          {selectedMember && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-amber-400 to-orange-500 flex items-center justify-center text-white font-extrabold text-lg shadow-sm">
                    {selectedMember.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-lg font-bold">
                        {selectedMember.name}
                      </DialogTitle>
                      <Badge
                        className={cn(
                          "text-xs font-semibold",
                          TIER_CONFIG[selectedMember.tier]?.bgBadge
                        )}
                      >
                        {TIER_CONFIG[selectedMember.tier]?.icon} {TIER_CONFIG[selectedMember.tier]?.label}
                      </Badge>
                    </div>
                    {selectedMember.nickname && (
                      <DialogDescription className="text-xs">
                        Biệt danh: {selectedMember.nickname}
                      </DialogDescription>
                    )}
                  </div>
                </div>
              </DialogHeader>

              {/* Stats Overview Grid */}
              <div className="grid grid-cols-3 gap-2.5 my-3">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                  <p className="text-xs text-muted-foreground">Hạng hiện tại</p>
                  <p className="text-2xl font-black text-amber-600 dark:text-amber-400">
                    #{selectedMember.rank}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-center">
                  <p className="text-xs text-muted-foreground">Điểm ELO</p>
                  <p className="text-2xl font-black text-primary">
                    {selectedMember.elo}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <p className="text-xs text-muted-foreground">Tỉ lệ Thắng</p>
                  <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    {selectedMember.winRate}%
                  </p>
                </div>
              </div>

              {/* Detailed Breakdown */}
              <div className="space-y-2 text-sm bg-muted/40 p-3 rounded-xl border">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Tổng số trận tham gia:</span>
                  <span className="font-bold">{selectedMember.matchesPlayed} trận</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Kết quả chi tiết:</span>
                  <div className="flex items-center gap-2 font-medium">
                    <span className="text-emerald-600">{selectedMember.wins} Thắng</span>
                    <span>•</span>
                    <span className="text-amber-600">{selectedMember.draws} Hòa</span>
                    <span>•</span>
                    <span className="text-rose-600">{selectedMember.losses} Thua</span>
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Phong độ gần nhất:</span>
                  <div className="flex items-center gap-1">
                    {selectedMember.recentForm.length > 0 ? (
                      selectedMember.recentForm.map((f, i) => renderFormBadge(f, i))
                    ) : (
                      <span className="text-muted-foreground">Chưa có</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Match History Timeline */}
              <div className="space-y-2 mt-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <History className="h-4 w-4 text-primary" />
                  <span>Lịch sử thay đổi ELO qua các trận</span>
                </div>

                {selectedMember.history && selectedMember.history.length > 0 ? (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {[...selectedMember.history].reverse().map((h, idx) => {
                      const isWin = h.result === "WIN";
                      const isDraw = h.result === "DRAW";
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 rounded-lg border bg-background/80 text-xs gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant={isWin ? "default" : isDraw ? "secondary" : "destructive"}
                                className={cn(
                                  "text-[10px] font-bold px-1.5 py-0 h-4.5",
                                  isWin && "bg-emerald-600 hover:bg-emerald-600 text-white",
                                  isDraw && "bg-amber-500 hover:bg-amber-500 text-white",
                                  !isWin && !isDraw && "bg-rose-600 hover:bg-rose-600 text-white"
                                )}
                              >
                                {isWin ? "THẮNG" : isDraw ? "HÒA" : "THUA"}
                              </Badge>
                              <span className="font-medium text-foreground truncate">
                                {h.teamName} vs {h.opponentName}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {h.date ? new Date(h.date).toLocaleDateString("vi-VN") : "Trận đấu"}
                              {h.scoreLabel && ` • Tỉ lệ tiền: ${h.scoreLabel}`}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <span
                              className={cn(
                                "font-extrabold text-xs block",
                                h.delta > 0
                                  ? "text-emerald-600"
                                  : h.delta < 0
                                  ? "text-rose-600"
                                  : "text-muted-foreground"
                              )}
                            >
                              {h.delta > 0 ? `+${h.delta}` : h.delta}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              → {h.newElo}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Chưa có lịch sử đấu được ghi nhận.
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function CrownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
    </svg>
  );
}

export default PublicElo;
