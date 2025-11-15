import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Trophy,
  TrendingUp,
  Calendar,
  Info,
  ChevronDown,
} from "lucide-react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Match {
  id: string;
  date: Timestamp | string;
  totalAmount: number;
  status: "PENDING" | "COMPLETED" | "PUBLISHED";
}

interface Member {
  id: string;
  name: string;
}

interface RatingData {
  averageScore: number;
  totalPoints: number;
  ratingCount: number;
  details: { ratedBy: string; score: number }[];
}

interface MvpData {
  mvpId: string;
  mvpName: string;
  voteCount: number;
  votedBy: string[];
}

const PublicRatings = () => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playerRatings, setPlayerRatings] = useState<Map<string, RatingData>>(
    new Map()
  );
  const [mvpData, setMvpData] = useState<MvpData[]>([]);
  const [showAllMvp, setShowAllMvp] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [overallStats, setOverallStats] = useState<{
    topRatings: { memberId: string; memberName: string; averageScore: number }[];
    topMvp: { memberId: string; memberName: string; voteCount: number }[];
    isLoading: boolean;
  }>({ topRatings: [], topMvp: [], isLoading: true });
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);

  useEffect(() => {
    const fetchMembers = async () => {
      const membersSnapshot = await getDocs(collection(db, "members"));
      const membersMap = new Map(
        membersSnapshot.docs.map((doc) => [doc.id, doc.data().name as string])
      );
      setMembers(membersMap);
    };
    fetchMembers();
  }, []);

  useEffect(() => {
    const matchesQuery = query(
      collection(db, "matches"),
      where("status", "==", "PUBLISHED"),
      orderBy("date", "desc")
    );
    const unsubscribe = onSnapshot(matchesQuery, (querySnapshot) => {
      const matchesList = querySnapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Match)
      );
      setMatches(matchesList);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedMatchId || members.size === 0) return;

    setIsLoadingDetails(true);
    const ratingsQuery = query(
      collection(db, "matches", selectedMatchId, "ratings")
    );
    const unsubscribeRatings = onSnapshot(ratingsQuery, (ratingsSnapshot) => {
      const ratingsByPlayer = new Map<string, RatingData>();
      const mvpVotes = new Map<string, { count: number; voters: string[] }>();

      ratingsSnapshot.forEach((doc) => {
        const rating = doc.data();
        const ratedByName = members.get(rating.ratedByMemberId) || "Không rõ";

        rating.playerRatings.forEach(
          (playerRating: { memberId: string; score: number }) => {
            const current = ratingsByPlayer.get(playerRating.memberId) || {
              averageScore: 0,
              totalPoints: 0,
              ratingCount: 0,
              details: [],
            };
            current.totalPoints += playerRating.score;
            current.ratingCount += 1;
            current.details.push({
              ratedBy: ratedByName,
              score: playerRating.score,
            });
            ratingsByPlayer.set(playerRating.memberId, current);
          }
        );

        if (rating.mvpPlayerId) {
          const currentMvp = mvpVotes.get(rating.mvpPlayerId) || {
            count: 0,
            voters: [],
          };
          currentMvp.count += 1;
          currentMvp.voters.push(ratedByName);
          mvpVotes.set(rating.mvpPlayerId, currentMvp);
        }
      });

      ratingsByPlayer.forEach((data) => {
        data.averageScore = data.totalPoints / data.ratingCount;
      });

      const sortedMvp = Array.from(mvpVotes.entries())
        .map(([mvpId, data]) => ({
          mvpId,
          mvpName: members.get(mvpId) || "Không rõ",
          voteCount: data.count,
          votedBy: data.voters,
        }))
        .sort((a, b) => b.voteCount - a.voteCount);

      setPlayerRatings(ratingsByPlayer);
      setMvpData(sortedMvp);
      setIsLoadingDetails(false);
    });

    return () => unsubscribeRatings();
  }, [selectedMatchId, members]);

  useEffect(() => {
    if (members.size === 0) return;

    const fetchOverallStats = async () => {
      setOverallStats((prev) => ({ ...prev, isLoading: true }));

      const matchesQuery = query(
        collection(db, "matches"),
        where("status", "==", "PUBLISHED")
      );
      const matchesSnapshot = await getDocs(matchesQuery);

      const allPlayerRatings = new Map<
        string,
        { totalPoints: number; ratingCount: number }
      >();
      const allMvpVotes = new Map<string, number>();

      for (const matchDoc of matchesSnapshot.docs) {
        const ratingsQuery = query(collection(matchDoc.ref, "ratings"));
        const ratingsSnapshot = await getDocs(ratingsQuery);

        ratingsSnapshot.forEach((ratingDoc) => {
          const rating = ratingDoc.data();

          rating.playerRatings.forEach(
            (playerRating: { memberId: string; score: number }) => {
              const current = allPlayerRatings.get(playerRating.memberId) || {
                totalPoints: 0,
                ratingCount: 0,
              };
              current.totalPoints += playerRating.score;
              current.ratingCount += 1;
              allPlayerRatings.set(playerRating.memberId, current);
            }
          );

          if (rating.mvpPlayerId) {
            allMvpVotes.set(
              rating.mvpPlayerId,
              (allMvpVotes.get(rating.mvpPlayerId) || 0) + 1
            );
          }
        });
      }

      const calculatedRatings = Array.from(allPlayerRatings.entries())
        .map(([memberId, data]) => ({
          memberId,
          memberName: members.get(memberId) || "Không rõ",
          averageScore:
            data.ratingCount > 0 ? data.totalPoints / data.ratingCount : 0,
        }))
        .sort((a, b) => b.averageScore - a.averageScore)
        .slice(0, 3);

      const sortedMvp = Array.from(allMvpVotes.entries())
        .map(([memberId, voteCount]) => ({
          memberId,
          memberName: members.get(memberId) || "Không rõ",
          voteCount,
        }))
        .sort((a, b) => b.voteCount - a.voteCount)
        .slice(0, 3);

      setOverallStats({
        topRatings: calculatedRatings,
        topMvp: sortedMvp,
        isLoading: false,
      });
    };

    fetchOverallStats();
  }, [members]);

  const sortedPlayerRatings = useMemo(() => {
    return Array.from(playerRatings.entries()).sort(
      ([, a], [, b]) => b.averageScore - a.averageScore
    );
  }, [playerRatings]);

  return (
    <div className="min-h-screen animated-gradient p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Bảng xếp hạng & MVP
          </h1>
          <p className="text-muted-foreground mt-2">
            Xem lại đánh giá và cầu thủ xuất sắc nhất từ các trận đã đấu.
          </p>
        </div>

        <div className="mb-8 grid gap-6 md:grid-cols-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-500" /> Top 3 Điểm Cao
                Nhất
              </CardTitle>
              <CardDescription>Tính trên tất cả các trận đã đấu</CardDescription>
            </CardHeader>
            <CardContent>
              {overallStats.isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <div className="space-y-3">
                  {overallStats.topRatings.map((player, index) => (
                    <div
                      key={player.memberId}
                      className="flex justify-between items-center"
                    >
                      <span
                        className={cn("font-semibold", index === 0 && "text-lg")}
                      >
                        {index + 1}. {player.memberName}
                      </span>
                      <Badge variant={index === 0 ? "default" : "secondary"}>
                        {player.averageScore.toFixed(2)} điểm
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" /> Top 3 MVP
              </CardTitle>
              <CardDescription>Tính trên tất cả các trận đã đấu</CardDescription>
            </CardHeader>
            <CardContent>
              {overallStats.isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <div className="space-y-3">
                  {overallStats.topMvp.map((player, index) => (
                    <div
                      key={player.memberId}
                      className="flex justify-between items-center"
                    >
                      <span
                        className={cn("font-semibold", index === 0 && "text-lg")}
                      >
                        {index + 1}. {player.memberName}
                      </span>
                      <Badge variant={index === 0 ? "default" : "secondary"}>
                        {player.voteCount} phiếu
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
          </div>
        ) : matches.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="p-12 text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
              <h3 className="mt-4 text-lg font-semibold">
                Chưa có trận đấu nào
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Chưa có trận đấu nào được công khai để xem đánh giá.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 md:col-span-4">
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle>Chi tiết từng trận</CardTitle>
                </CardHeader>
                <CardContent className="p-2 space-y-1">
                  {matches.map((match) => (
                    <button
                      key={match.id}
                      onClick={() => {
                        setSelectedMatchId(match.id);
                        setPlayerRatings(new Map());
                        setMvpData([]);
                      }}
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
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>
            <div className="col-span-12 md:col-span-8 space-y-6">
              {!selectedMatchId ? (
                <Card className="shadow-card">
                  <CardContent className="p-12 text-center flex flex-col items-center justify-center h-full">
                    <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                    <h3 className="mt-4 text-lg font-semibold">
                      Xem chi tiết trận đấu
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Hãy chọn một trận từ danh sách bên trái.
                    </p>
                  </CardContent>
                </Card>
              ) : isLoadingDetails ? (
                <Card className="shadow-card">
                  <CardContent className="p-12 text-center flex flex-col items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="mt-4 text-sm text-muted-foreground">
                      Đang tải chi tiết...
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="shadow-card">
                  {mvpData.length === 0 && playerRatings.size === 0 ? (
                    <CardContent className="p-12 text-center flex flex-col items-center justify-center h-full">
                      <Info className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                      <h3 className="mt-4 text-lg font-semibold">
                        Chưa có dữ liệu đánh giá
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Trận đấu này chưa có thông tin về MVP hoặc điểm số.
                      </p>
                    </CardContent>
                  ) : (
                    <CardContent className="p-4">
                      {mvpData.length > 0 && (
                        <Collapsible
                          open={openCollapsible === "mvp"}
                          onOpenChange={() =>
                            setOpenCollapsible(
                              openCollapsible === "mvp" ? null : "mvp"
                            )
                          }
                          className="w-full"
                        >
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between cursor-pointer p-2 rounded-md hover:bg-muted">
                              <div className="flex items-center gap-2">
                                <Trophy className="w-5 h-5 text-yellow-500" />
                                <h4 className="font-semibold">
                                  Cầu thủ xuất sắc nhất (MVP)
                                </h4>
                              </div>
                              <ChevronDown
                                className={cn(
                                  "h-5 w-5 transition-transform",
                                  openCollapsible === "mvp" && "rotate-180"
                                )}
                              />
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="py-2 px-4">
                            <div className="space-y-3">
                              {(showAllMvp
                                ? mvpData
                                : mvpData.slice(0, 3)
                              ).map((mvp, index) => (
                                <Dialog key={mvp.mvpId}>
                                  <DialogTrigger asChild>
                                    <div className="flex justify-between items-center cursor-pointer hover:bg-muted p-2 rounded-md">
                                      <span
                                        className={cn(
                                          "font-semibold",
                                          index === 0 && "text-lg"
                                        )}
                                      >
                                        {index + 1}. {mvp.mvpName}
                                      </span>
                                      <Badge
                                        variant={
                                          index === 0 ? "default" : "secondary"
                                        }
                                      >
                                        {mvp.voteCount} phiếu
                                      </Badge>
                                    </div>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>
                                        Danh sách bình chọn cho {mvp.mvpName}
                                      </DialogTitle>
                                    </DialogHeader>
                                    <ul className="text-sm space-y-2 max-h-60 overflow-y-auto">
                                      {mvp.votedBy.map((voter, i) => (
                                        <li key={i}>{voter}</li>
                                      ))}
                                    </ul>
                                  </DialogContent>
                                </Dialog>
                              ))}
                            </div>
                            {mvpData.length > 3 && (
                              <div className="mt-4 text-center">
                                <Button
                                  variant="link"
                                  className="p-0 h-auto"
                                  onClick={() => setShowAllMvp(!showAllMvp)}
                                >
                                  {showAllMvp ? "Thu gọn" : "Xem tất cả"}
                                </Button>
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                      {playerRatings.size > 0 && (
                        <Collapsible
                          open={openCollapsible === "ratings"}
                          onOpenChange={() =>
                            setOpenCollapsible(
                              openCollapsible === "ratings" ? null : "ratings"
                            )
                          }
                          className="w-full"
                        >
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between cursor-pointer p-2 rounded-md hover:bg-muted mt-2">
                              <div className="flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-blue-500" />
                                <h4 className="font-semibold">
                                  Bảng xếp hạng điểm
                                </h4>
                              </div>
                              <ChevronDown
                                className={cn(
                                  "h-5 w-5 transition-transform",
                                  openCollapsible === "ratings" && "rotate-180"
                                )}
                              />
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="py-2">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Hạng</TableHead>
                                  <TableHead>Cầu thủ</TableHead>
                                  <TableHead className="text-right">
                                    Điểm TB
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {sortedPlayerRatings.map(
                                  ([memberId, ratingData], index) => (
                                    <Dialog key={memberId}>
                                      <DialogTrigger asChild>
                                        <TableRow className="cursor-pointer">
                                          <TableCell className="font-medium">
                                            {index + 1}
                                          </TableCell>
                                          <TableCell>
                                            {members.get(memberId) || "Không rõ"}
                                          </TableCell>
                                          <TableCell className="text-right">
                                            <Badge
                                              variant="outline"
                                              className="cursor-pointer"
                                            >
                                              {ratingData.averageScore.toFixed(
                                                2
                                              )}
                                            </Badge>
                                          </TableCell>
                                        </TableRow>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle>
                                            Chi tiết điểm của{" "}
                                            {members.get(memberId) || "Không rõ"}
                                          </DialogTitle>
                                        </DialogHeader>
                                        <ul className="text-sm space-y-2 max-h-60 overflow-y-auto">
                                          {ratingData.details.map((d, i) => (
                                            <li
                                              key={i}
                                              className="flex justify-between"
                                            >
                                              <span>{d.ratedBy}</span>
                                              <strong>{d.score} điểm</strong>
                                            </li>
                                          ))}
                                        </ul>
                                      </DialogContent>
                                    </Dialog>
                                  )
                                )}
                              </TableBody>
                            </Table>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </CardContent>
                  )}
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicRatings;