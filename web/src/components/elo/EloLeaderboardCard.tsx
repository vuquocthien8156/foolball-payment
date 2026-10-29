import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import {
  MemberEloStats,
  GroupEloSnapshot,
  TIER_CONFIG,
  EloHistoryEntry
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
  Medal,
  Flame,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  ChevronRight,
  Shield,
  History,
  Calendar,
  Users,
  Award
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EloLeaderboardCardProps {
  maxDisplay?: number;
  showFullLink?: boolean;
  className?: string;
}

export const EloLeaderboardCard: React.FC<EloLeaderboardCardProps> = ({
  maxDisplay = 10,
  showFullLink = true,
  className
}) => {
  const { groupId, group } = useGroup();
  const groupPath = useGroupPath();
  const [snapshot, setSnapshot] = useState<GroupEloSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<MemberEloStats | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Subscribe to snapshot from groups/{groupId}/stats/elo
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
          // Fallback: try reading member collection directly
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

  const rankings = useMemo(() => snapshot?.rankings || [], [snapshot]);

  const filteredRankings = useMemo(() => {
    if (!searchQuery.trim()) return rankings;
    const q = searchQuery.toLowerCase().trim();
    return rankings.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.nickname && m.nickname.toLowerCase().includes(q))
    );
  }, [rankings, searchQuery]);

  const top3 = useMemo(() => rankings.slice(0, 3), [rankings]);
  const restRankings = useMemo(() => {
    if (searchQuery.trim()) return filteredRankings;
    return rankings.slice(3, maxDisplay);
  }, [rankings, filteredRankings, searchQuery, maxDisplay]);

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
    <>
      <Card className={cn("shadow-card overflow-hidden border-border/60", className)}>
        {/* Banner Header with Gradient */}
        <div className="bg-gradient-to-r from-amber-600 via-orange-500 to-yellow-500 p-4 sm:p-5 text-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/20 backdrop-blur-md rounded-xl shadow-inner flex items-center justify-center">
                <Trophy className="h-6 w-6 text-yellow-200" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight">
                    Bảng Xếp Hạng ELO
                  </h2>
                  <Badge variant="secondary" className="bg-white/25 text-white border-none text-[11px] font-medium">
                    Toàn bộ Active
                  </Badge>
                </div>
                <p className="text-xs text-white/90 mt-0.5">
                  Điểm số phong độ cộng/trừ theo kết quả thắng, thua, hoà từng trận
                </p>
              </div>
            </div>

            {showFullLink && (
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="bg-white/95 hover:bg-white text-orange-950 font-semibold shadow-sm w-fit self-end sm:self-auto"
              >
                <Link to={groupPath("public/elo")}>
                  <span>Xem BXH Chi tiết</span>
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>

        <CardContent className="p-4 sm:p-5 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground space-y-2">
              <div className="inline-block animate-spin">
                <Sparkles className="h-6 w-6 text-amber-500" />
              </div>
              <p className="text-sm">Đang tải bảng xếp hạng ELO...</p>
            </div>
          ) : rankings.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Chưa có dữ liệu ELO cho nhóm này.</p>
            </div>
          ) : (
            <>
              {/* TOP 3 PODIUM (Visible when no search active) */}
              {!searchQuery.trim() && top3.length > 0 && (
                <div className="pt-2 pb-4">
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 items-end max-w-2xl mx-auto">
                    {/* #2 SILVER (Left) */}
                    {top3[1] && (
                      <div
                        onClick={() => handleOpenMember(top3[1])}
                        className="group relative cursor-pointer flex flex-col items-center p-3 sm:p-4 rounded-2xl bg-gradient-to-b from-slate-100 to-slate-200/80 dark:from-slate-800/60 dark:to-slate-900/60 border border-slate-300/80 dark:border-slate-700 hover:shadow-md hover:scale-[1.02] transition-all"
                      >
                        <div className="absolute -top-3.5 flex items-center justify-center w-7 h-7 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-extrabold text-xs shadow-sm border-2 border-background">
                          2
                        </div>
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-tr from-slate-400 to-slate-200 flex items-center justify-center text-slate-900 font-black text-base sm:text-lg shadow-inner mb-2 group-hover:ring-2 group-hover:ring-slate-400 transition-all">
                          {top3[1].name.charAt(0)}
                        </div>
                        <p className="font-bold text-xs sm:text-sm text-foreground text-center line-clamp-1">
                          {top3[1].name}
                        </p>
                        {top3[1].nickname && (
                          <p className="text-[10px] text-muted-foreground text-center line-clamp-1">
                            ({top3[1].nickname})
                          </p>
                        )}
                        <div className="mt-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-black text-xs sm:text-sm">
                            {top3[1].elo}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 font-medium">
                          {top3[1].winRate}% WR ({top3[1].wins}T)
                        </p>
                      </div>
                    )}

                    {/* #1 GOLD (Center, Elevated) */}
                    {top3[0] && (
                      <div
                        onClick={() => handleOpenMember(top3[0])}
                        className="group relative cursor-pointer flex flex-col items-center p-3.5 sm:p-5 rounded-2xl bg-gradient-to-b from-amber-50 via-yellow-100/90 to-amber-200/90 dark:from-amber-950/40 dark:via-yellow-950/30 dark:to-amber-900/40 border-2 border-amber-400 dark:border-amber-500 shadow-md hover:shadow-lg hover:scale-[1.03] transition-all -translate-y-2 z-10"
                      >
                        <div className="absolute -top-4 flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 text-amber-950 font-black text-sm shadow-md border-2 border-background">
                          👑
                        </div>
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-amber-400 via-yellow-300 to-orange-400 flex items-center justify-center text-amber-950 font-black text-lg sm:text-xl shadow-md ring-4 ring-amber-300/60 mb-2 group-hover:ring-amber-400 transition-all">
                          {top3[0].name.charAt(0)}
                        </div>
                        <Badge className="bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40 text-[10px] font-semibold py-0 px-1.5 mb-1">
                          Quán quân
                        </Badge>
                        <p className="font-extrabold text-sm sm:text-base text-foreground text-center line-clamp-1">
                          {top3[0].name}
                        </p>
                        {top3[0].nickname && (
                          <p className="text-[10px] text-muted-foreground text-center line-clamp-1">
                            ({top3[0].nickname})
                          </p>
                        )}
                        <div className="mt-2 text-center">
                          <span className="inline-block px-2.5 py-0.5 rounded-full bg-amber-600 text-white font-black text-sm sm:text-base shadow-xs">
                            {top3[0].elo}
                          </span>
                        </div>
                        <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-400 mt-1">
                          {top3[0].winRate}% WR ({top3[0].wins}T)
                        </p>
                      </div>
                    )}

                    {/* #3 BRONZE (Right) */}
                    {top3[2] && (
                      <div
                        onClick={() => handleOpenMember(top3[2])}
                        className="group relative cursor-pointer flex flex-col items-center p-3 sm:p-4 rounded-2xl bg-gradient-to-b from-orange-50 to-amber-100/70 dark:from-orange-950/30 dark:to-amber-950/30 border border-orange-300/80 dark:border-orange-800 hover:shadow-md hover:scale-[1.02] transition-all"
                      >
                        <div className="absolute -top-3.5 flex items-center justify-center w-7 h-7 rounded-full bg-orange-300 dark:bg-orange-800 text-orange-950 dark:text-orange-100 font-extrabold text-xs shadow-sm border-2 border-background">
                          3
                        </div>
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-tr from-orange-400 to-amber-300 flex items-center justify-center text-orange-950 font-black text-base sm:text-lg shadow-inner mb-2 group-hover:ring-2 group-hover:ring-orange-400 transition-all">
                          {top3[2].name.charAt(0)}
                        </div>
                        <p className="font-bold text-xs sm:text-sm text-foreground text-center line-clamp-1">
                          {top3[2].name}
                        </p>
                        {top3[2].nickname && (
                          <p className="text-[10px] text-muted-foreground text-center line-clamp-1">
                            ({top3[2].nickname})
                          </p>
                        )}
                        <div className="mt-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-full bg-orange-700 text-white font-black text-xs sm:text-sm">
                            {top3[2].elo}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 font-medium">
                          {top3[2].winRate}% WR ({top3[2].wins}T)
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SEARCH BAR */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm thành viên theo tên..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm bg-muted/30"
                />
              </div>

              {/* LEADERBOARD LIST / TABLE */}
              <div className="space-y-1.5 divide-y divide-border/40">
                {(searchQuery.trim() ? filteredRankings : restRankings).map((member) => {
                  const tier = TIER_CONFIG[member.tier] || TIER_CONFIG.silver;
                  return (
                    <div
                      key={member.memberId}
                      onClick={() => handleOpenMember(member)}
                      className="pt-2 first:pt-0 pb-1.5 px-2 rounded-xl flex items-center justify-between gap-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      {/* Left: Rank & Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            "w-6 text-center font-bold text-sm",
                            member.rank === 1 && "text-amber-500 font-extrabold",
                            member.rank === 2 && "text-slate-500 font-extrabold",
                            member.rank === 3 && "text-amber-700 font-extrabold",
                            member.rank > 3 && "text-muted-foreground"
                          )}
                        >
                          #{member.rank}
                        </span>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-foreground truncate">
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
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              {member.wins}T
                            </span>
                            <span>{member.draws}H</span>
                            <span className="text-rose-500">{member.losses}B</span>
                            <span>•</span>
                            <span>{member.winRate}% WR</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Elo & Form */}
                      <div className="flex items-center gap-3 shrink-0">
                        {/* Recent Form Badges */}
                        <div className="hidden sm:flex items-center gap-1">
                          {member.recentForm.slice(-3).map((f, i) =>
                            renderFormBadge(f, i)
                          )}
                        </div>

                        {/* Elo Badge */}
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-extrabold text-base text-foreground">
                              {member.elo}
                            </span>
                            {member.lastDelta !== undefined && member.lastDelta !== 0 && (
                              <span
                                className={cn(
                                  "text-[10px] font-bold px-1 rounded",
                                  member.lastDelta > 0
                                    ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
                                    : "text-rose-600 bg-rose-50 dark:bg-rose-950/40"
                                )}
                              >
                                {member.lastDelta > 0 ? `+${member.lastDelta}` : member.lastDelta}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">ELO</p>
                        </div>

                        <ChevronRight className="h-4 w-4 text-muted-foreground/60 hidden sm:block" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer View More */}
              {showFullLink && rankings.length > maxDisplay && !searchQuery.trim() && (
                <div className="pt-2 text-center border-t">
                  <Button asChild variant="ghost" size="sm" className="w-full text-xs font-semibold text-primary">
                    <Link to={groupPath("public/elo")}>
                      Xem toàn bộ {rankings.length} thành viên & lịch sử phong độ
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* DETAILED PLAYER ELO MODAL */}
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
                  <span className="text-muted-foreground">Phong độ 5 trận gần nhất:</span>
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
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
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
    </>
  );
};

