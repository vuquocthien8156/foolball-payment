import {
  Card,
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

interface TopHighlight {
  mvpName: string;
  mvpVotes: number;
  topScorerName: string;
  topScorerScore: number;
  matchDateLabel: string;
}

const MIN_MVP_VOTES = 2;

const PublicPortal = () => {
  const [highlight, setHighlight] = useState<TopHighlight | null>(null);
  const [isLoadingHighlight, setIsLoadingHighlight] = useState(false);
  const [scoreboard, setScoreboard] = useState<
    { teamId: string; teamName: string; wins: number }[]
  >([]);
  const [isLoadingScoreboard, setIsLoadingScoreboard] = useState(true);

  useEffect(() => {
    const fetchHighlight = async () => {
      setIsLoadingHighlight(true);
      try {
        const matchesQuery = query(
          collection(db, "matches"),
          where("status", "==", "PUBLISHED"),
          orderBy("date", "desc"),
          limit(3)
        );
        const matchesSnapshot = await getDocs(matchesQuery);

        let latest: TopHighlight | null = null;

        for (const matchDoc of matchesSnapshot.docs) {
          const matchData = matchDoc.data();
          if (matchData.isDeleted) continue;
          const dateObj = matchData.date;
          const matchDate =
            dateObj?.toDate?.() || new Date(dateObj as unknown as string);

          // Check if all shares are paid before showing ratings
          const sharesSnapshot = await getDocs(
            collection(matchDoc.ref, "shares")
          );
          const totalShares = sharesSnapshot.size;
          if (totalShares === 0) continue;

          let paidCount = 0;
          sharesSnapshot.forEach((shareDoc) => {
            if (shareDoc.data().status === "PAID") {
              paidCount++;
            }
          });

          // Only show ratings if all shares are paid
          if (paidCount !== totalShares) {
            continue;
          }

          const ratingsSnapshot = await getDocs(
            collection(matchDoc.ref, "ratings")
          );
          if (ratingsSnapshot.empty) continue;

          const playerRatings = new Map<
            string,
            { totalPoints: number; ratingCount: number }
          >();
          const mvpVotes = new Map<string, number>();

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
              }
            );

            if (rating.mvpPlayerId) {
              if (rating.ratedByMemberId === rating.mvpPlayerId) {
                return;
              }
              mvpVotes.set(
                rating.mvpPlayerId,
                (mvpVotes.get(rating.mvpPlayerId) || 0) + 1
              );
            }
          });

          const topRatingEntry = Array.from(playerRatings.entries()).sort(
            (a, b) =>
              (b[1].totalPoints / b[1].ratingCount || 0) -
              (a[1].totalPoints / a[1].ratingCount || 0)
          )[0];

          const topMvpEntry = Array.from(mvpVotes.entries())
            .filter(([, count]) => count >= MIN_MVP_VOTES)
            .sort((a, b) => b[1] - a[1])[0];

          // Chỉ fetch tên cho hai người cần hiển thị
          const memberIds = [topRatingEntry?.[0], topMvpEntry?.[0]].filter(
            Boolean
          ) as string[];
          const nameCache = new Map<string, string>();
          await Promise.all(
            memberIds.map(async (id) => {
              const snap = await getDoc(doc(db, "members", id));
              if (snap.exists()) {
                nameCache.set(id, snap.data().name || "Không rõ");
              }
            })
          );

          latest = {
            mvpName: topMvpEntry
              ? nameCache.get(topMvpEntry[0]) || "Không rõ"
              : "Chưa đủ 2 phiếu hợp lệ",
            mvpVotes: topMvpEntry?.[1] || 0,
            topScorerName: topRatingEntry
              ? nameCache.get(topRatingEntry[0]) || "Không rõ"
              : "Chưa có",
            topScorerScore: topRatingEntry
              ? topRatingEntry[1].ratingCount > 0
                ? topRatingEntry[1].totalPoints / topRatingEntry[1].ratingCount
                : 0
              : 0,
            matchDateLabel: matchDate.toLocaleDateString("vi-VN"),
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
  }, []);

  useEffect(() => {
    const fetchScoreboard = async () => {
      setIsLoadingScoreboard(true);
      try {
        const matchesSnapshot = await getDocs(
          query(collection(db, "matches"), orderBy("date", "desc"), limit(25))
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
            collection(matchDoc.ref, "shares")
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
            (a, b) => a[1].total - b[1].total
          );
          if (sortedTotals[0][1].total === sortedTotals[1][1].total) continue;

          const [winningId, winningInfo] = sortedTotals[0];
          const current = winsMap.get(winningId);
          if (current) {
            current.wins += 1;
            // chỉ cập nhật tên nếu đang để trống
            if (!current.teamName || current.teamName.startsWith("Đội")) {
              current.teamName = winningInfo.teamName;
            }
            winsMap.set(winningId, current);
          }
        }

        const sortedWins = Array.from(winsMap.values()).sort(
          (a, b) => b.wins - a.wins
        );

        setScoreboard(sortedWins.slice(0, 2));
      } catch (error) {
        console.error("Error fetching scoreboard:", error);
        setScoreboard([]);
      } finally {
        setIsLoadingScoreboard(false);
      }
    };

    fetchScoreboard();
  }, []);

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
          <h1 className="text-4xl font-bold text-foreground">Football Tools</h1>
          <p className="text-muted-foreground mt-2">
            Vui lòng chọn hành động bạn muốn thực hiện.
          </p>
        </div>

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
                    {highlight.topScorerName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {highlight.topScorerScore.toFixed(2)} điểm TB
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
            ) : scoreboard.length >= 2 ? (
              <div className="relative bg-muted/30 rounded-3xl border shadow-inner p-4 flex items-center justify-between gap-4">
                {scoreboard.slice(0, 2).map((team, idx) => (
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

        <div className="space-y-6">
          <Link to="/public/attendance" className="block">
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

          <Link to="/public/pay" className="block">
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
          <Link to="/public/ratings" className="block">
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
        </div>
      </div>
    </div>
  );
};

export default PublicPortal;
