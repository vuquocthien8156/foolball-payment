import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  Users,
  TrendingUp,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Trash2,
  Search,
  ClipboardList,
  Calculator,
  Send,
  Pencil,
  Trophy,
  PlusCircle,
  Star,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  writeBatch,
  Timestamp,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

interface Match {
  id: string;
  date: Timestamp | string;
  totalAmount: number;
  status: "PENDING" | "COMPLETED" | "PUBLISHED";
  teamNames?: { [key: string]: string };
  teamsConfig?: {
    id: string;
    name: string;
  }[];
}

interface Share {
  id: string;
  memberId: string;
  teamId: string;
  teamName?: string; // Add teamName
  amount: number;
  status: "PENDING" | "PAID" | "CANCELLED";
  paidAt?: string;
  createdAt?: Timestamp;
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

interface MatchListItemProps {
  match: Match;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

const MatchListItem = ({
  match,
  isSelected,
  onSelect,
  onDelete,
  onEdit,
}: MatchListItemProps) => {
  const [stats, setStats] = useState({
    paidAmount: 0,
    paidCount: 0,
    totalShares: 0,
    isLoading: true,
  });

  useEffect(() => {
    const sharesQuery = query(collection(db, "matches", match.id, "shares"));
    const unsubscribe = onSnapshot(sharesQuery, (snapshot) => {
      let paidAmount = 0;
      let paidCount = 0;
      const totalShares = snapshot.size;

      snapshot.forEach((doc) => {
        const share = doc.data() as Share;
        if (share.status === "PAID") {
          paidAmount += share.amount;
          paidCount++;
        }
      });

      setStats({ paidAmount, paidCount, totalShares, isLoading: false });
    });

    return () => unsubscribe();
  }, [match.id]);

  const date = new Date(
    typeof match.date === "string" ? match.date : match.date.toDate()
  ).toLocaleDateString("vi-VN");

  const isFullyPaid =
    !stats.isLoading &&
    stats.totalShares > 0 &&
    stats.paidCount === stats.totalShares;

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg transition-colors",
        isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      )}
    >
      <button onClick={onSelect} className="flex-grow text-left space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Trận ngày {date}</p>
          {match.status && (
            <Tooltip>
              <TooltipTrigger>
                {match.status === "PUBLISHED" ? (
                  <Send className="h-5 w-5 text-sky-500" />
                ) : match.status === "COMPLETED" ? (
                  <Calculator className="h-5 w-5 text-amber-500" />
                ) : (
                  <ClipboardList className="h-5 w-5 text-muted-foreground" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {match.status === "PUBLISHED"
                    ? "Đã công khai"
                    : match.status === "COMPLETED"
                    ? "Đã tính tiền"
                    : "Đang điểm danh"}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="text-sm opacity-80">
          Tổng: {match.totalAmount.toLocaleString()} VND
        </p>
        {!stats.isLoading && (
          <>
            <p className="text-sm opacity-80">
              Đã thu: {stats.paidAmount.toLocaleString()} VND
            </p>
            <p className="text-sm opacity-80">
              Hoàn thành: {stats.paidCount}/{stats.totalShares}
            </p>
          </>
        )}
      </button>
      <div className="flex items-center flex-shrink-0">
        {!isFullyPaid && match.status !== "PUBLISHED" && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "rounded-full w-8 h-8",
                    isSelected
                      ? "hover:bg-primary-foreground/10 text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "rounded-full w-8 h-8",
                      isSelected
                        ? "hover:bg-primary-foreground/10 text-primary-foreground"
                        : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
};

const Matches = () => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PAID" | "PENDING">(
    "ALL"
  );
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [matchIdToDelete, setMatchIdToDelete] = useState<string | null>(null);
  const [highlightedShareId, setHighlightedShareId] = useState<string | null>(
    null
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [playerRatings, setPlayerRatings] = useState<Map<string, RatingData>>(
    new Map()
  );
  const [mvpData, setMvpData] = useState<MvpData[]>([]);
  const [showAllMvp, setShowAllMvp] = useState(false);
  const [activeTab, setActiveTab] = useState("payment");
  const [crossRatings, setCrossRatings] = useState<
    Map<
      string,
      {
        ratedByName: string;
        ratingsGiven: { playerRatedId: string; score: number }[];
      }
    >
  >(new Map());
  const [selectedRaterId, setSelectedRaterId] = useState<string | null>(null);
  const [isLoadingRatings, setIsLoadingRatings] = useState(false);

  useEffect(() => {
    const matchId = searchParams.get("matchId");
    if (
      matches.length > 0 &&
      matchId &&
      matches.some((m) => m.id === matchId)
    ) {
      setSelectedMatchId(matchId);
    }
  }, [searchParams, matches]);

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const membersSnapshot = await getDocs(collection(db, "members"));
        const membersMap = new Map(
          membersSnapshot.docs.map((doc) => [doc.id, doc.data().name as string])
        );
        setMembers(membersMap);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tải danh sách thành viên.",
        });
      }
    };
    fetchMembers();
  }, []);

  useEffect(() => {
    setIsLoadingMatches(true);
    const matchesQuery = query(
      collection(db, "matches"),
      orderBy("date", "desc")
    );
    const unsubscribe = onSnapshot(
      matchesQuery,
      (querySnapshot) => {
        const matchesList = querySnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as Match)
        );
        setMatches(matchesList);
        if (
          !selectedMatchId &&
          matchesList.length > 0 &&
          !searchParams.get("matchId")
        ) {
          setSelectedMatchId(matchesList[0].id);
        }
        setIsLoadingMatches(false);
      },
      () => {
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tải danh sách trận đấu.",
        });
        setIsLoadingMatches(false);
      }
    );
    return () => unsubscribe();
  }, [searchParams, selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchId) return;
    setIsLoadingShares(true);

    const sharesQuery = query(
      collection(db, "matches", selectedMatchId, "shares"),
      orderBy("createdAt", "desc")
    );
    const unsubscribeShares = onSnapshot(sharesQuery, (querySnapshot) => {
      const currentMatch = matches.find((m) => m.id === selectedMatchId);
      let teamNames: { [key: string]: string } = {};
      if (currentMatch?.teamsConfig) {
        teamNames = currentMatch.teamsConfig.reduce((acc, team) => {
          acc[team.id] = team.name;
          return acc;
        }, {} as { [key: string]: string });
      } else if (currentMatch?.teamNames) {
        teamNames = currentMatch.teamNames;
      }

      const sharesList = querySnapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
            teamName:
              teamNames[doc.data().teamId] || `Đội ${doc.data().teamId}`,
          } as Share)
      );
      setShares(sharesList);
      setIsLoadingShares(false);
    });

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

      // Process cross-ratings
      setIsLoadingRatings(true);
      const ratingsByRater = new Map<
        string,
        {
          ratedByName: string;
          ratingsGiven: { playerRatedId: string; score: number }[];
        }
      >();

      ratingsSnapshot.forEach((doc) => {
        const rating = doc.data();
        const ratedByMemberId = rating.ratedByMemberId;
        const ratedByName = members.get(ratedByMemberId) || "Không rõ";

        if (!ratingsByRater.has(ratedByMemberId)) {
          ratingsByRater.set(ratedByMemberId, {
            ratedByName: ratedByName,
            ratingsGiven: [],
          });
        }

        rating.playerRatings.forEach(
          (playerRating: { memberId: string; score: number }) => {
            ratingsByRater.get(ratedByMemberId)!.ratingsGiven.push({
              playerRatedId: playerRating.memberId,
              score: playerRating.score,
            });
          }
        );
      });

      setCrossRatings(ratingsByRater);
      setSelectedRaterId(null); // Reset rater selection on match change
      setIsLoadingRatings(false);
    });

    return () => {
      unsubscribeShares();
      unsubscribeRatings();
    };
  }, [selectedMatchId, matches, members]);

  const handleDeleteMatch = async () => {
    if (!matchIdToDelete) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      const sharesSnapshot = await getDocs(
        collection(db, "matches", matchIdToDelete, "shares")
      );
      sharesSnapshot.forEach((shareDoc) => batch.delete(shareDoc.ref));
      batch.delete(doc(db, "matches", matchIdToDelete));
      await batch.commit();
      toast({
        title: "Thành công",
        description: "Đã xóa trận đấu và các khoản phí liên quan.",
      });
      if (selectedMatchId === matchIdToDelete) {
        const remainingMatches = matches.filter(
          (m) => m.id !== matchIdToDelete
        );
        setSelectedMatchId(
          remainingMatches.length > 0 ? remainingMatches[0].id : null
        );
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xóa trận đấu.",
      });
    } finally {
      setIsDeleting(false);
      setMatchIdToDelete(null);
    }
  };

  const handleMarkAsPaid = async (shareId: string) => {
    if (!selectedMatchId) return;
    try {
      await updateDoc(doc(db, "matches", selectedMatchId, "shares", shareId), {
        status: "PAID",
        paidAt: new Date().toISOString(),
        channel: "MANUAL",
      });
      toast({
        title: "Thành công",
        description: "Đã cập nhật trạng thái thanh toán.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái.",
      });
    }
  };

  const handleMarkAsUnpaid = async (shareId: string) => {
    if (!selectedMatchId) return;
    try {
      await updateDoc(doc(db, "matches", selectedMatchId, "shares", shareId), {
        status: "PENDING",
        paidAt: deleteField(),
        channel: deleteField(),
      });
      toast({
        title: "Thành công",
        description: "Đã cập nhật trạng thái thành Chưa trả.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái.",
      });
    }
  };

  const filteredShares = useMemo(() => {
    return shares.filter((share) => {
      const memberName = members.get(share.memberId) || "";
      const nameMatch = searchTerm
        ? memberName.toLowerCase().includes(searchTerm.toLowerCase())
        : true;
      const statusMatch =
        statusFilter === "ALL" ? true : share.status === statusFilter;
      return nameMatch && statusMatch;
    });
  }, [shares, searchTerm, statusFilter, members]);

  const {
    totalAmount,
    paidAmount,
    pendingAmount,
    paidCount,
    totalShares,
    isFullyPaid,
  } = useMemo(() => {
    const total = shares.reduce((sum, s) => sum + s.amount, 0);
    const paid = shares
      .filter((s) => s.status === "PAID")
      .reduce((sum, s) => sum + s.amount, 0);
    const paidCountNum = shares.filter((s) => s.status === "PAID").length;
    const totalSharesNum = shares.length;
    return {
      totalAmount: total,
      paidAmount: paid,
      pendingAmount: total - paid,
      paidCount: paidCountNum,
      totalShares: totalSharesNum,
      isFullyPaid: totalSharesNum > 0 && paidCountNum === totalSharesNum,
    };
  }, [shares]);

  const selectedMatch = matches.find((m) => m.id === selectedMatchId);

  const matchDateString = useMemo(() => {
    if (!selectedMatch?.date) return "";
    return new Date(
      typeof selectedMatch.date === "string"
        ? selectedMatch.date
        : selectedMatch.date.toDate()
    ).toLocaleDateString("vi-VN");
  }, [selectedMatch]);

  const topMvp = useMemo(() => {
    if (mvpData.length === 0) return null;
    return mvpData[0];
  }, [mvpData]);

  const topScorer = useMemo(() => {
    if (playerRatings.size === 0) return null;
    const [memberId, ratingData] = Array.from(playerRatings.entries()).sort(
      ([, a], [, b]) => b.averageScore - a.averageScore
    )[0];
    const shareInfo = shares.find((s) => s.memberId === memberId);
    return {
      memberId,
      name: members.get(memberId) || "Không rõ",
      teamName: shareInfo?.teamName || "N/A",
      averageScore: ratingData.averageScore,
      ratingCount: ratingData.ratingCount,
    };
  }, [playerRatings, members, shares]);

  const handleUpdateMatchStatus = useCallback(
    async (newStatus: "PUBLISHED" | "COMPLETED") => {
      if (!selectedMatchId) return;
      const matchRef = doc(db, "matches", selectedMatchId);
      try {
        await updateDoc(matchRef, { status: newStatus });
        toast({
          title: "Thành công",
          description: `Đã cập nhật trạng thái trận đấu thành ${
            newStatus === "PUBLISHED" ? "Công khai" : "Đã tính tiền"
          }.`,
        });
      } catch (error) {
        console.error("Error updating match status:", error);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể cập nhật trạng thái trận đấu.",
        });
      }
    },
    [selectedMatchId]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Quản lý Trận đấu
          </h1>
          <Button onClick={() => navigate("/admin/setup")}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Tạo trận đấu mới
          </Button>
        </div>
        <div className="grid lg:grid-cols-12 gap-8">
          <div className="lg:col-span-3 lg:sticky lg:top-6 h-fit">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Danh sách trận đấu</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingMatches ? (
                  <div className="p-6 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : (
                  <AlertDialog
                    open={!!matchIdToDelete}
                    onOpenChange={(isOpen) =>
                      !isOpen && setMatchIdToDelete(null)
                    }
                  >
                    <div className="space-y-1 p-2">
                      {matches.map((match) => (
                        <MatchListItem
                          key={match.id}
                          match={match}
                          isSelected={selectedMatchId === match.id}
                          onSelect={() => setSelectedMatchId(match.id)}
                          onDelete={() => setMatchIdToDelete(match.id)}
                          onEdit={() => navigate(`/admin/setup/${match.id}`)}
                        />
                      ))}
                    </div>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Bạn có chắc chắn muốn xóa?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Hành động này không thể hoàn tác. Thao tác này sẽ xóa
                          vĩnh viễn trận đấu và tất cả dữ liệu thanh toán liên
                          quan.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Hủy</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeleteMatch}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={isDeleting}
                        >
                          {isDeleting && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}{" "}
                          Xóa
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-9">
            {!selectedMatchId ? (
              <Card className="shadow-card">
                <CardContent className="p-12 text-center">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                  <h3 className="mt-4 text-lg font-semibold">
                    Chưa chọn trận đấu
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Hãy chọn một trận từ danh sách để xem chi tiết.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  {!isFullyPaid && (
                    <>
                      {selectedMatch?.status !== "PUBLISHED" ? (
                        <Button
                          onClick={() => handleUpdateMatchStatus("PUBLISHED")}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Công khai
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleUpdateMatchStatus("COMPLETED")}
                          variant="destructive"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Hủy công khai
                        </Button>
                      )}
                    </>
                  )}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Star className="mr-2 h-4 w-4" />
                        Xem đánh giá
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl">
                      <DialogHeader>
                        <DialogTitle>
                          Đánh giá cho trận ngày {matchDateString}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="max-h-[80vh] overflow-y-auto p-4">
                        <Tabs defaultValue="ratings" className="w-full">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="ratings">
                              Xếp hạng & MVP
                            </TabsTrigger>
                            <TabsTrigger value="cross-rating">
                              Đánh giá chéo
                            </TabsTrigger>
                          </TabsList>
                          <TabsContent value="ratings" className="mt-6">
                            {mvpData.length > 0 && (
                              <Card className="mb-6">
                                <CardHeader>
                                  <CardTitle className="text-lg flex items-center gap-2">
                                    <Trophy className="w-5 h-5 text-yellow-500" />
                                    Cầu thủ xuất sắc nhất (MVP)
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="space-y-3">
                                    {(showAllMvp
                                      ? mvpData
                                      : mvpData.slice(0, 3)
                                    ).map((mvp, index) => (
                                      <Dialog key={mvp.mvpId}>
                                        <DialogTrigger asChild>
                                          <div
                                            className={cn(
                                              "flex justify-between items-center cursor-pointer hover:bg-muted p-2 rounded-md",
                                              index === 0 &&
                                                "bg-yellow-100 dark:bg-yellow-900/50"
                                            )}
                                          >
                                            <div className="flex items-center gap-3">
                                              {index === 0 && (
                                                <Trophy className="w-6 h-6 text-yellow-500" />
                                              )}
                                              <span
                                                className={cn(
                                                  "font-semibold",
                                                  index === 0
                                                    ? "text-lg text-yellow-600 dark:text-yellow-400"
                                                    : "text-sm"
                                                )}
                                              >
                                                {index + 1}. {mvp.mvpName}
                                              </span>
                                            </div>
                                            <Badge
                                              variant={
                                                index === 0
                                                  ? "default"
                                                  : "secondary"
                                              }
                                              className={cn(
                                                index === 0 &&
                                                  "bg-yellow-500 text-white"
                                              )}
                                            >
                                              {mvp.voteCount} phiếu
                                            </Badge>
                                          </div>
                                        </DialogTrigger>
                                        <DialogContent>
                                          <DialogHeader>
                                            <DialogTitle>
                                              Danh sách bình chọn cho{" "}
                                              {mvp.mvpName}
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
                                        onClick={() =>
                                          setShowAllMvp(!showAllMvp)
                                        }
                                      >
                                        {showAllMvp ? "Thu gọn" : "Xem tất cả"}
                                      </Button>
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
                            )}
                            {playerRatings.size > 0 ? (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Hạng</TableHead>
                                    <TableHead>Thành viên</TableHead>
                                    <TableHead>Đội</TableHead>
                                    <TableHead className="text-right">
                                      Điểm TB
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {Array.from(playerRatings.entries())
                                    .sort(
                                      ([, a], [, b]) =>
                                        b.averageScore - a.averageScore
                                    )
                                    .map(([memberId, ratingData], index) => {
                                      const shareInfo = shares.find(
                                        (s) => s.memberId === memberId
                                      );
                                      const teamName =
                                        shareInfo?.teamName || "N/A";
                                      const isTopScorer = index === 0;
                                      return (
                                        <Dialog key={memberId}>
                                          <DialogTrigger asChild>
                                            <TableRow
                                              className={cn(
                                                "cursor-pointer",
                                                isTopScorer &&
                                                  "bg-green-100 dark:bg-green-900/50"
                                              )}
                                            >
                                              <TableCell
                                                className={cn(
                                                  isTopScorer &&
                                                    "font-bold text-lg"
                                                )}
                                              >
                                                {index + 1}
                                              </TableCell>
                                              <TableCell
                                                className={cn(
                                                  "font-medium",
                                                  isTopScorer &&
                                                    "text-lg text-green-600 dark:text-green-400"
                                                )}
                                              >
                                                <div className="flex items-center gap-2">
                                                  {isTopScorer && (
                                                    <Trophy className="w-5 h-5 text-green-500" />
                                                  )}
                                                  {members.get(memberId) ||
                                                    "Không rõ"}
                                                </div>
                                              </TableCell>
                                              <TableCell>{teamName}</TableCell>
                                              <TableCell className="text-right">
                                                <Badge
                                                  variant={
                                                    isTopScorer
                                                      ? "default"
                                                      : "outline"
                                                  }
                                                  className={cn(
                                                    isTopScorer &&
                                                      "bg-green-500 text-white text-base px-3 py-1"
                                                  )}
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
                                                {members.get(memberId) ||
                                                  "Không rõ"}
                                              </DialogTitle>
                                            </DialogHeader>
                                            <ul className="text-sm space-y-2 max-h-60 overflow-y-auto">
                                              {ratingData.details.map(
                                                (d, i) => (
                                                  <li
                                                    key={i}
                                                    className="flex justify-between"
                                                  >
                                                    <span>{d.ratedBy}</span>
                                                    <strong>
                                                      {d.score} điểm
                                                    </strong>
                                                  </li>
                                                )
                                              )}
                                            </ul>
                                          </DialogContent>
                                        </Dialog>
                                      );
                                    })}
                                </TableBody>
                              </Table>
                            ) : (
                              <div className="text-center p-8 text-muted-foreground">
                                Chưa có dữ liệu xếp hạng cho trận này.
                              </div>
                            )}
                          </TabsContent>
                          <TabsContent value="cross-rating" className="mt-6">
                            {isLoadingRatings ? (
                              <div className="text-center p-8">
                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                              </div>
                            ) : crossRatings.size === 0 ? (
                              <div className="text-center p-8 text-muted-foreground">
                                Chưa có dữ liệu đánh giá cho trận này.
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <div>
                                  <Select
                                    onValueChange={setSelectedRaterId}
                                    value={selectedRaterId || ""}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Chọn người đánh giá để xem điểm" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Array.from(crossRatings.entries()).map(
                                        ([raterId, data]) => (
                                          <SelectItem
                                            key={raterId}
                                            value={raterId}
                                          >
                                            {data.ratedByName}
                                          </SelectItem>
                                        )
                                      )}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {selectedRaterId && (
                                  <Card>
                                    <CardHeader>
                                      <CardTitle>
                                        Điểm do{" "}
                                        {
                                          crossRatings.get(selectedRaterId)
                                            ?.ratedByName
                                        }{" "}
                                        chấm
                                      </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead>
                                              Cầu thủ được đánh giá
                                            </TableHead>
                                            <TableHead className="text-right">
                                              Điểm
                                            </TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {crossRatings
                                            .get(selectedRaterId)
                                            ?.ratingsGiven.sort(
                                              (a, b) => b.score - a.score
                                            )
                                            .map(({ playerRatedId, score }) => (
                                              <TableRow key={playerRatedId}>
                                                <TableCell className="font-medium">
                                                  {members.get(playerRatedId) ||
                                                    "Không rõ"}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold">
                                                  {score}
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                        </TableBody>
                                      </Table>
                                    </CardContent>
                                  </Card>
                                )}
                              </div>
                            )}
                          </TabsContent>
                        </Tabs>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="border-dashed">
                        <Trophy className="mr-2 h-4 w-4" />
                        Vinh danh dạng Poster
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-5xl p-0 overflow-hidden border-0 shadow-2xl">
                      {!topMvp && !topScorer ? (
                        <div className="p-8 text-center text-muted-foreground">
                          Chưa có dữ liệu để tạo poster.
                        </div>
                      ) : (
                        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
                          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 p-10 border-b border-white/10">
                            <div>
                              <p className="text-xs uppercase tracking-[0.35em] text-white/60">
                                Match Day
                              </p>
                              <h2 className="text-4xl font-black mt-2">
                                {matchDateString}
                              </h2>
                              <p className="text-sm text-white/70 mt-2">
                                Vinh danh MVP & cầu thủ điểm cao nhất
                              </p>
                            </div>
                            <div className="flex items-center gap-3 text-amber-300">
                              <Trophy className="w-10 h-10" />
                              <div className="font-semibold text-lg">
                                AWARDS NIGHT
                              </div>
                            </div>
                          </div>
                          <div className="grid gap-6 md:grid-cols-2 p-10">
                            <div className="relative rounded-3xl bg-white/5 border border-white/10 p-8 shadow-lg overflow-hidden">
                              <div className="absolute -right-6 -top-8 text-amber-400/20">
                                <Trophy className="w-52 h-52" />
                              </div>
                              {topMvp ? (
                                <div className="relative space-y-4">
                                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/20 text-amber-200 px-3 py-1 text-xs font-semibold">
                                    MVP TOP 1
                                  </div>
                                  <h3 className="text-3xl font-black">
                                    {topMvp.mvpName}
                                  </h3>
                                  <p className="text-sm text-white/70">
                                    {topMvp.voteCount} phiếu bình chọn
                                  </p>
                                  <div className="mt-6 flex items-center gap-3">
                                    <div className="bg-amber-500 rounded-full p-4 shadow-inner">
                                      <Trophy className="w-10 h-10 text-white" />
                                    </div>
                                    <div className="text-sm text-white/70">
                                      Được bình chọn nhiều nhất trong trận
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-white/60">
                                  Chưa có dữ liệu MVP.
                                </p>
                              )}
                            </div>
                            <div className="relative rounded-3xl bg-white/5 border border-white/10 p-8 shadow-lg overflow-hidden">
                              <div className="absolute -left-10 -bottom-16 text-emerald-300/20">
                                <Trophy className="w-60 h-60" />
                              </div>
                              {topScorer ? (
                                <div className="relative space-y-4">
                                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-400/20 text-emerald-100 px-3 py-1 text-xs font-semibold">
                                    ĐIỂM TB CAO NHẤT
                                  </div>
                                  <h3 className="text-3xl font-black">
                                    {topScorer.name}
                                  </h3>
                                  <p className="text-sm text-white/70">
                                    {topScorer.teamName}
                                  </p>
                                  <div className="text-5xl font-black tracking-tight text-emerald-200">
                                    {topScorer.averageScore.toFixed(2)}
                                  </div>
                                  <p className="text-sm text-white/70">
                                    {topScorer.ratingCount} lượt đánh giá
                                  </p>
                                </div>
                              ) : (
                                <p className="text-sm text-white/60">
                                  Chưa có dữ liệu điểm trung bình.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Tổng tiền
                      </CardTitle>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {selectedMatch.totalAmount.toLocaleString()} VND
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Đã thu
                      </CardTitle>
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-500">
                        {paidAmount.toLocaleString()} VND
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {paidCount}/{totalShares} đã thanh toán
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Còn lại
                      </CardTitle>
                      <Clock className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-orange-500">
                        {pendingAmount.toLocaleString()} VND
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Hoàn thành
                      </CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {totalAmount > 0
                          ? Math.round((paidAmount / totalAmount) * 100)
                          : 0}
                        %
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <Card className="shadow-card">
                  <CardHeader>
                    <CardTitle>Chi tiết</CardTitle>
                    <CardDescription>
                      Thông tin thanh toán và đánh giá của trận đấu.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row gap-4 mb-6">
                      <div className="relative flex-grow">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Tìm theo tên thành viên..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <Tabs
                        value={statusFilter}
                        onValueChange={(value) =>
                          setStatusFilter(value as "ALL" | "PAID" | "PENDING")
                        }
                      >
                        <TabsList>
                          <TabsTrigger value="ALL">Tất cả</TabsTrigger>
                          <TabsTrigger value="PAID">Đã trả</TabsTrigger>
                          <TabsTrigger value="PENDING">Chưa trả</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    {isLoadingShares ? (
                      <div className="text-center p-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Thành viên</TableHead>
                            <TableHead>Đội</TableHead>
                            <TableHead>Số tiền</TableHead>
                            <TableHead>Trạng thái</TableHead>
                            <TableHead className="text-right">
                              Hành động
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredShares.map((share) => (
                            <TableRow
                              key={share.id}
                              className={cn(
                                highlightedShareId === share.id &&
                                  "bg-yellow-200/50 transition-all duration-500"
                              )}
                            >
                              <TableCell className="font-medium">
                                {members.get(share.memberId) || "Không rõ"}
                              </TableCell>
                              <TableCell>{share.teamName}</TableCell>
                              <TableCell>
                                {share.amount.toLocaleString()} VND
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    share.status === "PAID"
                                      ? "default"
                                      : "secondary"
                                  }
                                >
                                  {share.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {!isFullyPaid && (
                                  <>
                                    {share.status === "PENDING" && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          handleMarkAsPaid(share.id)
                                        }
                                      >
                                        Đã trả
                                      </Button>
                                    )}
                                    {share.status === "PAID" && (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() =>
                                          handleMarkAsUnpaid(share.id)
                                        }
                                      >
                                        Chưa trả
                                      </Button>
                                    )}
                                  </>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Matches;
