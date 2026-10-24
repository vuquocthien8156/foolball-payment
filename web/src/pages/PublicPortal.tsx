import { groupIdOf, scopedKey, groupKindOf } from "@/lib/groups";
import { hasFeature } from "@/lib/features";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { getApiBaseUrl } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarCheck,
  CreditCard,
  Loader2,
  Trophy,
  TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ensureNotificationToken } from "@/lib/notifications";
import { formatMatchDateTime } from "@/lib/utils";

interface TopHighlight {
  mvpName: string;
  mvpVotes: number;
  topScorerNames: string[];
  topScorerFinal: number;
  topScorerPeer: number;
  topScorerAdmin: number;
  hasAdminScore: boolean;
  matchDateLabel: string;
}

const MIN_MVP_VOTES = 2;

const SharedBillsPublicPortal = ({
  groupId,
  group,
}: {
  groupId: string;
  group: any;
}) => {
  const [data, setData] = useState<{ bills: any[]; payout: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/public/${groupId}/shared-bills`)
      .then((res) => res.json())
      .then((res) => setData(res))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [groupId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-muted-foreground">Đang tải thông tin nhóm...</p>
      </div>
    );
  }

  const bills = data?.bills || [];
  const payout = data?.payout;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {group?.name || "Chia sẻ chi phí"}
          </h1>
          <p className="text-sm text-slate-500">
            Trang công khai theo dõi các khoản thu và thanh toán của nhóm.
          </p>
        </header>

        {payout?.accountNumber ? (
          <Card className="border-emerald-200/60 bg-gradient-to-br from-emerald-50/50 to-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-emerald-800">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                Thông tin chuyển khoản
              </CardTitle>
              <CardDescription>
                Quét mã VietQR hoặc chuyển khoản trực tiếp theo thông tin bên
                dưới:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center gap-6 justify-center">
                {payout.bankBin && payout.accountNumber ? (
                  <div className="rounded-xl border bg-white p-2 shadow-sm">
                    <img
                      src={`https://img.vietqr.io/image/${payout.bankBin}-${payout.accountNumber}-compact.png?accountName=${encodeURIComponent(payout.accountHolder || "")}`}
                      alt="VietQR Chuyển khoản"
                      className="w-48 h-auto rounded-lg"
                    />
                  </div>
                ) : null}
                <div className="space-y-2 text-sm text-center sm:text-left">
                  <p>
                    <span className="text-slate-500">Ngân hàng:</span>{" "}
                    <strong>{payout.bankName || payout.bankBin}</strong>
                  </p>
                  <p className="flex items-center justify-center sm:justify-start gap-2">
                    <span className="text-slate-500">Số tài khoản:</span>
                    <strong className="font-mono text-base">
                      {payout.accountNumber}
                    </strong>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          payout.accountNumber,
                        );
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? "Đã chép" : "Sao chép"}
                    </Button>
                  </p>
                  <p>
                    <span className="text-slate-500">Chủ tài khoản:</span>{" "}
                    <strong>{payout.accountHolder || "—"}</strong>
                  </p>
                  <p className="text-xs text-slate-400">
                    Nội dung chuyển khoản: Tên của bạn + Tên khoản thu
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="space-y-4">
          <h2 className="text-lg font-bold">Khoản thu đang mở</h2>
          {!bills.length ? (
            <Card className="p-8 text-center text-slate-500 border-dashed">
              Không có khoản thu nào đang chờ thanh toán.
            </Card>
          ) : (
            bills.map((bill) => (
              <Card key={bill.id} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">{bill.title}</CardTitle>
                      <CardDescription>
                        Hạn thanh toán:{" "}
                        <strong className="text-slate-700">
                          {bill.dueDate}
                        </strong>
                      </CardDescription>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                      {bill.amountVnd.toLocaleString("vi-VN")} VND
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Danh sách thành viên:
                    </p>
                    <div className="divide-y rounded-lg border bg-white">
                      {bill.allocations.map((a: any) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between p-3 text-sm"
                        >
                          <span className="font-medium">{a.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono">
                              {a.amountVnd.toLocaleString("vi-VN")} VND
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                a.state === "paid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : a.state === "covered_by_payer"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {a.state === "paid"
                                ? "Đã trả"
                                : a.state === "covered_by_payer"
                                  ? "Đã tính phần ứng"
                                  : "Chưa trả"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const PublicPortal = () => {
  const { groupId, group } = useGroup();
  const groupPath = useGroupPath();
  if (groupKindOf(group) === "shared_bills") {
    return <SharedBillsPublicPortal groupId={groupId} group={group} />;
  }
  const [highlight, setHighlight] = useState<TopHighlight | null>(null);
  const [isLoadingHighlight, setIsLoadingHighlight] = useState(false);
  const [scoreboard, setScoreboard] = useState<
    { teamId: string; teamName: string; wins: number }[]
  >([]);
  const [isLoadingScoreboard, setIsLoadingScoreboard] = useState(true);

  useEffect(() => {
    const requestNotify = async () => {
      if (typeof Notification === "undefined") return;
      const prompted = localStorage.getItem(
        scopedKey("publicNotifyPrompted", groupId),
      );
      if (prompted && Notification.permission === "denied") return;
      const token = await ensureNotificationToken(null, groupId);
      localStorage.setItem(scopedKey("publicNotifyPrompted", groupId), "1");
      if (token) {
        console.info("[notify] Token registered from /public");
      }
    };
    requestNotify();
  }, [groupId]);

  useEffect(() => {
    if (!hasFeature(groupId, group, "ratings")) {
      setIsLoadingHighlight(false);
      return;
    }
    const fetchHighlight = async () => {
      setIsLoadingHighlight(true);
      try {
        const matchesQuery = query(
          collection(db, "matches"),
          where("groupId", "==", groupId),
          where("status", "==", "PUBLISHED"),
          orderBy("date", "desc"),
          limit(3),
        );
        const matchesSnapshot = await getDocs(matchesQuery);

        let latest: TopHighlight | null = null;

        for (const matchDoc of matchesSnapshot.docs) {
          const matchData = matchDoc.data();
          if (matchData.isDeleted) continue;

          // Only show ratings if admin has published them
          if (!matchData.ratingsPublished) continue;

          const dateObj = matchData.date;
          const matchDate =
            dateObj?.toDate?.() || new Date(dateObj as unknown as string);

          const ratingsSnapshot = await getDocs(
            collection(matchDoc.ref, "ratings"),
          );
          const adminRatingsSnapshot = await getDocs(
            collection(matchDoc.ref, "adminRatings"),
          );
          if (ratingsSnapshot.empty && adminRatingsSnapshot.empty) continue;

          const playerRatings = new Map<
            string,
            { totalPoints: number; ratingCount: number }
          >();
          const mvpVotes = new Map<string, number>();
          const adminRatings = new Map<string, number>();

          ratingsSnapshot.forEach((ratingDoc) => {
            const rating = ratingDoc.data();
            rating.playerRatings.forEach(
              (playerRating: { memberId: string; score: number }) => {
                const current = playerRatings.get(playerRating.memberId) || {
                  totalPoints: 0,
                  ratingCount: 0,
                };
                current.totalPoints += playerRating.score;
                current.ratingCount += 1;
                playerRatings.set(playerRating.memberId, current);
              },
            );

            if (rating.mvpPlayerId) {
              if (rating.ratedByMemberId === rating.mvpPlayerId) {
                return;
              }
              mvpVotes.set(
                rating.mvpPlayerId,
                (mvpVotes.get(rating.mvpPlayerId) || 0) + 1,
              );
            }
          });

          adminRatingsSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const raw = data.score;
            const score =
              typeof raw === "number" ? raw : Number.parseFloat(raw || "0");
            if (!Number.isFinite(score)) return;
            adminRatings.set(docSnap.id, score);
          });

          const combinedRatings = new Map<
            string,
            { peer: number; admin: number; final: number; hasAdmin: boolean }
          >();

          playerRatings.forEach((data, memberId) => {
            const peer =
              data.ratingCount > 0 ? data.totalPoints / data.ratingCount : 0;
            const admin = adminRatings.get(memberId) || 0;
            combinedRatings.set(memberId, {
              peer,
              admin,
              final: Math.min(peer + admin, 10),
              hasAdmin: adminRatings.has(memberId),
            });
          });

          adminRatings.forEach((admin, memberId) => {
            if (combinedRatings.has(memberId)) return;
            combinedRatings.set(memberId, {
              peer: 0,
              admin,
              final: Math.min(admin, 10),
              hasAdmin: true,
            });
          });

          const ratingEntries = Array.from(combinedRatings.entries()).sort(
            (a, b) => b[1].final - a[1].final,
          );
          const topRatingEntry = ratingEntries[0];
          const topRatingEntries =
            ratingEntries.length > 0
              ? ratingEntries.filter(
                  (entry) =>
                    Math.abs(entry[1].final - ratingEntries[0][1].final) < 1e-9,
                )
              : [];

          const topMvpEntry = Array.from(mvpVotes.entries())
            .filter(([, count]) => count >= MIN_MVP_VOTES)
            .sort((a, b) => b[1] - a[1])[0];

          // Chỉ fetch tên cho những người cần hiển thị
          const memberIds = Array.from(
            new Set(
              [
                ...topRatingEntries.map((entry) => entry[0]),
                topMvpEntry?.[0],
              ].filter(Boolean) as string[],
            ),
          );
          const nameCache = new Map<string, string>();
          await Promise.all(
            memberIds.map(async (id) => {
              const snap = await getDoc(doc(db, "members", id));
              if (snap.exists() && groupIdOf(snap.data()) === groupId) {
                nameCache.set(id, snap.data().name || "Không rõ");
              }
            }),
          );

          latest = {
            mvpName: topMvpEntry
              ? nameCache.get(topMvpEntry[0]) || "Không rõ"
              : "Chưa đủ 2 phiếu hợp lệ",
            mvpVotes: topMvpEntry?.[1] || 0,
            topScorerNames:
              topRatingEntries.length > 0
                ? topRatingEntries.map(
                    (entry) => nameCache.get(entry[0]) || "Không rõ",
                  )
                : [],
            topScorerFinal: topRatingEntry ? topRatingEntry[1].final : 0,
            topScorerPeer: topRatingEntry ? topRatingEntry[1].peer : 0,
            topScorerAdmin: topRatingEntry ? topRatingEntry[1].admin : 0,
            hasAdminScore: topRatingEntry ? topRatingEntry[1].hasAdmin : false,
            matchDateLabel: formatMatchDateTime(matchDate),
          };
          break;
        }

        setHighlight(latest);
      } catch (error) {
        console.error("Error fetching highlight:", error);
        setHighlight(null);
      } finally {
        setIsLoadingHighlight(false);
      }
    };

    fetchHighlight();
  }, [groupId, group]);

  useEffect(() => {
    if (!hasFeature(groupId, group, "scoring")) {
      setIsLoadingScoreboard(false);
      return;
    }
    const fetchScoreboard = async () => {
      setIsLoadingScoreboard(true);
      try {
        const matchesSnapshot = await getDocs(
          query(
            collection(db, "matches"),
            where("groupId", "==", groupId),
            orderBy("date", "desc"),
            limit(25),
          ),
        );

        const winsMap = new Map<
          string,
          { teamId: string; teamName: string; wins: number }
        >();

        for (const matchDoc of matchesSnapshot.docs) {
          const matchData = matchDoc.data();
          if (matchData.isDeleted) continue;
          if (matchData.status && matchData.status !== "PUBLISHED") {
            continue;
          }
          const sharesSnapshot = await getDocs(
            collection(matchDoc.ref, "shares"),
          );
          if (sharesSnapshot.empty) continue;

          const totals = new Map<string, { total: number; teamName: string }>();

          sharesSnapshot.forEach((shareDoc) => {
            const share = shareDoc.data();
            if (!share.teamId || typeof share.amount !== "number") return;
            const teamId = share.teamId;
            const teamName =
              matchData.teamNames?.[teamId] ||
              matchData.teamsConfig?.find((t: any) => t.id === teamId)?.name ||
              `Đội ${teamId}`;
            const entry = totals.get(teamId) || { total: 0, teamName };
            entry.total += share.amount;
            entry.teamName = teamName;
            totals.set(teamId, entry);
          });

          totals.forEach((info, teamId) => {
            const record = winsMap.get(teamId);
            if (!record) {
              winsMap.set(teamId, {
                teamId,
                teamName: info.teamName,
                wins: 0,
              });
            }
          });

          if (totals.size < 2) continue;
          const sortedTotals = Array.from(totals.entries()).sort(
            (a, b) => a[1].total - b[1].total,
          );
          // Only count a win if there's a single lowest-paying team (no tie at the bottom)
          if (sortedTotals[0][1].total === sortedTotals[1][1].total) continue;

          const [winningId, winningInfo] = sortedTotals[0];
          const current = winsMap.get(winningId);
          if (current) {
            current.wins += 1;
            if (!current.teamName || current.teamName.startsWith("Đội")) {
              current.teamName = winningInfo.teamName;
            }
            winsMap.set(winningId, current);
          }
        }

        const sortedWins = Array.from(winsMap.values()).sort(
          (a, b) => b.wins - a.wins,
        );

        setScoreboard(sortedWins);
      } catch (error) {
        console.error("Error fetching scoreboard:", error);
        setScoreboard([]);
      } finally {
        setIsLoadingScoreboard(false);
      }
    };

    fetchScoreboard();
  }, [groupId, group]);

  if (isLoadingHighlight) {
    return (
      <div className="min-h-screen animated-gradient flex items-center justify-center p-4">
        <div className="flex flex-col items-center justify-center gap-4 bg-background/90 p-8 rounded-2xl shadow-card">
          <div className="p-4 bg-primary rounded-full text-primary-foreground shadow-card">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
          <p className="text-foreground font-semibold">
            Đang tải dữ liệu mới nhất...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen animated-gradient flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-4 bg-primary rounded-2xl shadow-card mb-4">
            <Trophy className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-foreground">
            {group?.sport === "badminton" ? group.name : "Football Tools"}
          </h1>
          <p className="text-muted-foreground mt-2">
            Vui lòng chọn hành động bạn muốn thực hiện.
          </p>
        </div>

        {hasFeature(groupId, group, "ratings") && (
          <Card className="shadow-card overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-400 p-4 text-white">
              <CardTitle className="text-lg">Vinh danh trận gần nhất</CardTitle>
              <CardDescription className="text-white/80">
                {highlight?.matchDateLabel || "Chưa có dữ liệu"}
              </CardDescription>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              <div className="p-4 rounded-xl bg-white/70 backdrop-blur shadow-inner">
                <div className="flex items-center gap-2 text-amber-600">
                  <Trophy className="h-5 w-5" />
                  <span className="font-semibold">Cầu thủ ấn tượng (vote)</span>
                </div>
                {isLoadingHighlight ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    Đang tải...
                  </p>
                ) : highlight ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-lg font-bold text-foreground">
                      {highlight.mvpName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {highlight.mvpVotes} phiếu
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">
                    Chưa có dữ liệu.
                  </p>
                )}
              </div>

              <div className="p-4 rounded-xl bg-white/70 backdrop-blur shadow-inner">
                <div className="flex items-center gap-2 text-emerald-600">
                  <TrendingUp className="h-5 w-5" />
                  <span className="font-semibold">MVP (điểm cao nhất)</span>
                </div>
                {isLoadingHighlight ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    Đang tải...
                  </p>
                ) : highlight ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-lg font-bold text-foreground">
                      {highlight.topScorerNames.length > 0
                        ? highlight.topScorerNames.join(", ")
                        : "Chưa có"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {highlight.topScorerFinal.toFixed(2)} điểm cuối /10{" "}
                      {highlight.topScorerNames.length > 1 && "(Đồng MVP)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Peer: {highlight.topScorerPeer.toFixed(2)} /5 • Admin:{" "}
                      {highlight.hasAdminScore
                        ? `${highlight.topScorerAdmin.toFixed(2)} /5`
                        : "Chưa chấm"}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">
                    Chưa có dữ liệu.
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {hasFeature(groupId, group, "scoring") && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle>Bảng tỉ số</CardTitle>
            </CardHeader>
            <div className="px-4 pb-6">
              {isLoadingScoreboard ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang tổng hợp dữ liệu...
                </div>
              ) : scoreboard.length >= 2 && scoreboard.length <= 2 ? (
                <div className="relative bg-muted/30 rounded-3xl border shadow-inner p-4 flex items-center justify-between gap-4">
                  {scoreboard.map((team) => (
                    <div
                      key={team.teamId}
                      className="flex-1 text-center space-y-1"
                    >
                      <p className="text-lg font-semibold text-foreground">
                        {team.teamName}
                      </p>
                      <p className="text-4xl font-extrabold text-primary">
                        {team.wins}
                      </p>
                    </div>
                  ))}
                  <div className="absolute left-1/2 -translate-x-1/2 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold shadow">
                      VS
                    </div>
                  </div>
                </div>
              ) : scoreboard.length >= 3 ? (
                <div className="bg-muted/30 rounded-3xl border shadow-inner p-4 space-y-3">
                  {scoreboard.map((team, idx) => (
                    <div
                      key={team.teamId}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-background/60"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-muted-foreground w-6 text-center">
                          {idx + 1}
                        </span>
                        <p className="text-lg font-semibold text-foreground">
                          {team.teamName}
                        </p>
                      </div>
                      <p className="text-3xl font-extrabold text-primary">
                        {team.wins}
                      </p>
                    </div>
                  ))}
                </div>
              ) : scoreboard.length === 1 ? (
                <div className="relative bg-muted/30 rounded-3xl border shadow-inner p-4 flex items-center justify-between gap-4">
                  {[
                    scoreboard[0],
                    { teamId: "pending", teamName: "Đang cập nhật", wins: 0 },
                  ].map((team) => (
                    <div
                      key={team.teamId}
                      className="flex-1 text-center space-y-1"
                    >
                      <p className="text-lg font-semibold text-foreground">
                        {team.teamName}
                      </p>
                      <p className="text-4xl font-extrabold text-primary">
                        {team.wins}
                      </p>
                    </div>
                  ))}
                  <div className="absolute left-1/2 -translate-x-1/2 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold shadow">
                      VS
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Chưa có dữ liệu thống kê.
                </p>
              )}
            </div>
          </Card>
        )}

        <div className="space-y-6">
          <Link to={groupPath("public/attendance")} className="block">
            <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                  <CalendarCheck className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl">Điểm danh</CardTitle>
                  <CardDescription>
                    Xác nhận tham gia trận đấu sắp tới.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link to={groupPath("public/pay")} className="block">
            <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                  <CreditCard className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl">Thanh toán</CardTitle>
                  <CardDescription>
                    Xem và thanh toán các khoản nợ.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
          {hasFeature(groupId, group, "ratings") && (
            <Link to={groupPath("public/ratings")} className="block">
              <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                    <TrendingUp className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Xem lịch sử trận</CardTitle>
                    <CardDescription>
                      Ratings, MVP/ấn tượng và live notes của các trận đã đấu.
                    </CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicPortal;
