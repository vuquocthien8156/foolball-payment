import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Users, TrendingUp, Loader2, Trophy, Star } from "lucide-react";
import { collection, query, onSnapshot, getDocs, Timestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";

type TimeFilter = "all" | "week" | "month";

interface StatData {
  topPayers: { name: string; total: number }[];
  topRated: { name: string; avg: number }[];
  topMvps: { name: string; count: number }[];
}

const MIN_MVP_VOTES = 2;

const Dashboard = () => {
  const [stats, setStats] = useState<StatData>({ topPayers: [], topRated: [], topMvps: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");

  useEffect(() => {
      const fetchStats = async () => {
        setIsLoading(true);
        
        const membersSnapshot = await getDocs(collection(db, "members"));
        const membersMap = new Map(membersSnapshot.docs.map(doc => [doc.id, doc.data().name as string]));

        let matchesQuery = query(collection(db, "matches"));
        const now = new Date();
      if (timeFilter === "week") {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        matchesQuery = query(matchesQuery, where("date", ">=", Timestamp.fromDate(weekAgo)));
      } else if (timeFilter === "month") {
        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        matchesQuery = query(matchesQuery, where("date", ">=", Timestamp.fromDate(monthAgo)));
      }

      const unsubscribe = onSnapshot(matchesQuery, async (matchesSnapshot) => {
        const paymentsByMember = new Map<string, number>();
        const ratingsByPlayer = new Map<
          string,
          { finalTotal: number; peerTotal: number; adminTotal: number; matches: number }
        >();
        const mvpVotes = new Map<string, number>();

        for (const matchDoc of matchesSnapshot.docs) {
            if (matchDoc.data().isDeleted) continue;
            const sharesSnapshot = await getDocs(query(collection(db, "matches", matchDoc.id, "shares"), where("status", "==", "PAID")));
            sharesSnapshot.forEach(shareDoc => {
                const share = shareDoc.data();
                paymentsByMember.set(share.memberId, (paymentsByMember.get(share.memberId) || 0) + share.amount);
            });

            const perMatchPeer = new Map<string, { total: number; count: number }>();
            const perMatchAdmin = new Map<string, number>();

            const ratingsSnapshot = await getDocs(collection(db, "matches", matchDoc.id, "ratings"));
            ratingsSnapshot.forEach(ratingDoc => {
                const rating = ratingDoc.data();
                rating.playerRatings.forEach((pr: {memberId: string, score: number}) => {
                    const current = perMatchPeer.get(pr.memberId) || { total: 0, count: 0 };
                    perMatchPeer.set(pr.memberId, { total: current.total + pr.score, count: current.count + 1 });
                });
                if (rating.mvpPlayerId) {
                    if (rating.ratedByMemberId === rating.mvpPlayerId) {
                      return;
                    }
                    mvpVotes.set(rating.mvpPlayerId, (mvpVotes.get(rating.mvpPlayerId) || 0) + 1);
                }
            });

            const adminRatingsSnapshot = await getDocs(collection(db, "matches", matchDoc.id, "adminRatings"));
            adminRatingsSnapshot.forEach((adminDoc) => {
              const data = adminDoc.data() as { score?: number };
              const adminScore = typeof data.score === "number" ? data.score : 0;
              perMatchAdmin.set(adminDoc.id, adminScore);
            });

            const playerIds = new Set([
              ...Array.from(perMatchPeer.keys()),
              ...Array.from(perMatchAdmin.keys()),
            ]);
            playerIds.forEach((memberId) => {
              const peerScore = perMatchPeer.has(memberId)
                ? Math.min(
                    5,
                    perMatchPeer.get(memberId)!.total /
                      Math.max(1, perMatchPeer.get(memberId)!.count)
                  )
                : 0;
              const adminScore = Math.min(
                5,
                Math.max(0, perMatchAdmin.get(memberId) || 0)
              );
              const finalScore = Math.min(peerScore + adminScore, 10);
              const current = ratingsByPlayer.get(memberId) || {
                finalTotal: 0,
                peerTotal: 0,
                adminTotal: 0,
                matches: 0,
              };
              ratingsByPlayer.set(memberId, {
                finalTotal: current.finalTotal + finalScore,
                peerTotal: current.peerTotal + peerScore,
                adminTotal: current.adminTotal + adminScore,
                matches: current.matches + 1,
              });
            });
        }

        const topPayers = Array.from(paymentsByMember.entries()).map(([id, total]) => ({ name: membersMap.get(id) || "N/A", total })).sort((a,b) => b.total - a.total).slice(0,3);
        const topRated = Array.from(ratingsByPlayer.entries())
          .map(([id, data]) => {
            const matchCount = data.matches || 1;
            return {
              name: membersMap.get(id) || "N/A",
              avg: data.finalTotal / matchCount,
            };
          })
          .sort((a,b) => b.avg - a.avg)
          .slice(0,3);
        const topMvps = Array.from(mvpVotes.entries())
          .filter(([, count]) => count >= MIN_MVP_VOTES)
          .map(([id, count]) => ({ name: membersMap.get(id) || "N/A", count }))
          .sort((a,b) => b.count - a.count)
          .slice(0,3);

        setStats({ topPayers, topRated, topMvps });
        setIsLoading(false);
      });
      return unsubscribe;
    };

    const promise = fetchStats();
    return () => { promise.then(unsub => unsub && unsub()) };
  }, [timeFilter]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
            <h1 className="text-3xl font-bold text-foreground">Dashboard Tổng Quan</h1>
            <div className="flex gap-2">
                <Button variant={timeFilter === 'all' ? 'default' : 'outline'} onClick={() => setTimeFilter('all')}>Tất cả</Button>
                <Button variant={timeFilter === 'month' ? 'default' : 'outline'} onClick={() => setTimeFilter('month')}>Tháng này</Button>
                <Button variant={timeFilter === 'week' ? 'default' : 'outline'} onClick={() => setTimeFilter('week')}>Tuần này</Button>
            </div>
        </div>

        <div className="grid gap-8 md:grid-cols-1 lg:grid-cols-3">
            <LeaderboardCard title="Top 3 Trả Nhiều Nhất" data={stats.topPayers} icon={DollarSign} format={(v) => `${v.toLocaleString()} VND`} valueKey="total" />
            <LeaderboardCard title="Top 3 MVP (điểm cao)" data={stats.topRated} icon={Star} format={(v) => v.toFixed(2)} valueKey="avg" />
            <LeaderboardCard title="Top 3 Ấn tượng (vote)" data={stats.topMvps} icon={Trophy} format={(v) => `${v} phiếu`} valueKey="count" />
        </div>
      </div>
    </div>
  );
};

type LeaderboardItem = {
  name: string;
  total?: number;
  avg?: number;
  count?: number;
};

const LeaderboardCard = ({ title, data, icon: Icon, format, valueKey }: { title: string, data: LeaderboardItem[], icon: React.ElementType, format: (value: number) => string, valueKey: string }) => (
    <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2"><Icon className="w-5 h-5" />{title}</CardTitle>
        </CardHeader>
        <CardContent>
            {data.length > 0 ? (
                <ul className="space-y-4">
                    {data.map((item, index) => (
                        <li key={index} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <span className={`flex items-center justify-center w-8 h-8 rounded-full font-bold ${index === 0 ? 'bg-yellow-400' : index === 1 ? 'bg-gray-300' : 'bg-yellow-600/70'}`}>{index + 1}</span>
                                <p className="font-medium">{item.name}</p>
                            </div>
                            <p className="font-bold text-lg">{format(item[valueKey])}</p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground text-center">Không có dữ liệu.</p>
            )}
        </CardContent>
    </Card>
);

export default Dashboard;
