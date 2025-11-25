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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { aggregateLiveStats, AggregatedStat } from "@/lib/liveStats";
import { useActionConfigs } from "@/hooks/useActionConfigs";

interface Match {
  id: string;
  date: Timestamp | string;
  totalAmount: number;
  status: "PENDING" | "COMPLETED" | "PUBLISHED";
  isDeleted?: boolean;
  isTest?: boolean;
  ratingsPublished?: boolean;
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
              <TooltipTrigger asChild>
                <span>
                  {match.status === "PUBLISHED" ? (
                    <Send className="h-5 w-5 text-sky-500" />
                  ) : match.status === "COMPLETED" ? (
                    <Calculator className="h-5 w-5 text-amber-500" />
                  ) : (
                    <ClipboardList className="h-5 w-5 text-muted-foreground" />
                  )}
                </span>
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
        )}
        {(match.isTest || (!isFullyPaid && match.status !== "PUBLISHED")) && (
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
            <TooltipContent>Xóa trận (bao gồm trận test)</TooltipContent>
          </Tooltip>
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
  const [liveStatsMap, setLiveStatsMap] = useState<Map<string, AggregatedStat>>(
    new Map()
  );
  const [isLoadingLiveStats, setIsLoadingLiveStats] = useState(false);
  const [isLiveStatsDialogOpen, setIsLiveStatsDialogOpen] = useState(false);
  const { labelMap, weights } = useActionConfigs();
  const labelFor = useCallback(
    (key: string) =>
      labelMap.get(key) ||
      {
        goal: "Bàn thắng",
        assist: "Kiến tạo",
        save_gk: "Cản phá GK",
        tackle: "Tackle/Chặn",
        dribble: "Qua người",
        yellow: "Thẻ vàng",
        red: "Thẻ đỏ",
        foul: "Phạm lỗi",
        note: "Ghi chú",
      }[key] ||
      key,
    [labelMap]
  );

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
        const matchesList = querySnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() } as Match))
          .filter((m) => !m.isDeleted);
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

  useEffect(() => {
    if (!selectedMatchId) {
      setLiveStatsMap(new Map());
      setIsLoadingLiveStats(false);
      return;
    }
    setIsLoadingLiveStats(true);
    const liveEventsQuery = query(
      collection(db, "matches", selectedMatchId, "liveEvents"),
      orderBy("createdAt", "desc")
    );
    const unsubscribeLive = onSnapshot(
      liveEventsQuery,
      (snapshot) => {
        const events = snapshot.docs.map((doc) => ({
          ...(doc.data() as { memberId?: string; type: any }),
        }));
        setLiveStatsMap(aggregateLiveStats(events, weights));
        setIsLoadingLiveStats(false);
      },
      (err) => {
        console.error("[Matches] live events load error", err);
        setLiveStatsMap(new Map());
        setIsLoadingLiveStats(false);
      }
    );
    return () => unsubscribeLive();
  }, [selectedMatchId, weights]);

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

  const liveStatsList = useMemo(() => {
    return Array.from(liveStatsMap.values())
      .filter(
        (s) =>
          s.total > 0 || s.foul > 0 || s.yellow > 0 || s.red > 0 || s.note > 0
      )
      .sort((a, b) => {
        if (b.primaryScore !== a.primaryScore)
          return b.primaryScore - a.primaryScore;
        return b.total - a.total;
      });
  }, [liveStatsMap]);

  const memberTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    shares.forEach((s) => map.set(s.memberId, s.teamId));
    const matchCfg = matches.find((m) => m.id === selectedMatchId);
    if (matchCfg?.teamsConfig) {
      matchCfg.teamsConfig.forEach((team) => {
        (team.members || []).forEach((m) => map.set(m.id, team.id));
      });
    }
    return map;
  }, [shares, matches, selectedMatchId]);

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

  const teamScore = useMemo(() => {
    const map = new Map<string, number>();
    liveStatsMap.forEach((stat, memberId) => {
      const teamId = memberTeamMap.get(memberId) || "others";
      map.set(teamId, (map.get(teamId) || 0) + stat.goal);
    });
    return map;
  }, [liveStatsMap, memberTeamMap]);

  const topMedalScores = useMemo(() => {
    const unique = Array.from(
      new Set(liveStatsList.map((s) => s.primaryScore))
    );
    return unique.slice(0, 3);
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

  const topByField = useCallback(
    (
      statsList: AggregatedStat[],
      field: keyof AggregatedStat
    ): AggregatedStat[] => {
      return [...statsList].sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        if (typeof aVal === "number" && typeof bVal === "number") {
          return bVal - aVal;
        }
        return 0;
      });
    },
    []
  );

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

  const handleToggleRatingsPublished = useCallback(
    async (published: boolean) => {
      if (!selectedMatchId) return;
      const matchRef = doc(db, "matches", selectedMatchId);
      try {
        await updateDoc(matchRef, { ratingsPublished: published });
        toast({
          title: "Thành công",
          description: `Đã ${
            published ? "công khai" : "ẩn"
          } đánh giá trận đấu.`,
        });
      } catch (error) {
        console.error("Error toggling ratings published:", error);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể cập nhật trạng thái công khai đánh giá.",
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
            {!selectedMatchId || !selectedMatch ? (
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
                              Xếp hạng & Ấn tượng
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
                                    Cầu thủ ấn tượng (vote)
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
                  <Dialog
                    open={isLiveStatsDialogOpen}
                    onOpenChange={setIsLiveStatsDialogOpen}
                  >
                    <DialogTrigger asChild>
                      <Button variant="secondary">
                        <TrendingUp className="mr-2 h-4 w-4" />
                        Thống kê nhanh
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl">
                      <DialogHeader>
                        <DialogTitle>
                          Thống kê nhanh (Live notes) - {matchDateString}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="max-h-[70vh] overflow-y-auto">
                        {isLoadingLiveStats ? (
                          <div className="text-center py-6">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                            <p className="text-sm text-muted-foreground mt-2">
                              Đang tải live notes...
                            </p>
                          </div>
                        ) : liveStatsList.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Chưa có dữ liệu live notes cho trận này.
                          </p>
                        ) : (
                          <>
                            {Object.keys(currentTeamNames).length > 0 && (
                              <div className="grid grid-cols-2 gap-2 mb-3">
                                {Object.entries(currentTeamNames)
                                  .slice(0, 2)
                                  .map(([teamId, teamName]) => (
                                    <Card
                                      key={teamId}
                                      className="p-3 border-dashed"
                                    >
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
                                const medal = medalClassForScore(
                                  stats.primaryScore
                                );
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
                                      "rounded border p-2 bg-muted/30 text-xs space-y-1 w-[48%] sm:w-[31%] lg:w-[23%]",
                                      medalClass
                                    )}
                                  >
                                    <div className="font-semibold truncate flex items-center gap-1">
                                      {medalIcon && <span>{medalIcon}</span>}
                                      <span className="truncate">
                                        {members.get(stats.memberId) ||
                                          "Không rõ"}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
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
                                        <Badge
                                          variant="outline"
                                          className="cursor-default"
                                        >
                                          {labelFor("foul")} {stats.foul}
                                        </Badge>
                                      )}
                                      {stats.note > 0 && (
                                        <Badge
                                          variant="outline"
                                          className="cursor-default"
                                        >
                                          {labelFor("note")} {stats.note}
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
                                Vinh danh cầu thủ ấn tượng (vote) & MVP (điểm
                                cao nhất)
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
                                    ẤN TƯỢNG NHẤT (VOTE)
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
                                  Chưa có dữ liệu cầu thủ ấn tượng.
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
                                    MVP (ĐIỂM CAO NHẤT)
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
                            <div className="relative rounded-3xl bg-white/5 border border-white/10 p-8 shadow-lg overflow-hidden md:col-span-2">
                              <div className="absolute -right-10 -bottom-10 text-blue-300/15">
                                <Trophy className="w-72 h-72" />
                              </div>
                              <div className="relative grid gap-4 md:grid-cols-2">
                                <div className="space-y-3">
                                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 text-blue-100 px-3 py-1 text-xs font-semibold">
                                    VUA PHÁ LƯỚI
                                  </div>
                                  {topByField(liveStatsList, "goal")[0] ? (
                                    <div>
                                      <h3 className="text-2xl font-black">
                                        {members.get(
                                          topByField(liveStatsList, "goal")[0]
                                            .memberId
                                        ) || "Không rõ"}
                                      </h3>
                                      <p className="text-sm text-white/70">
                                        {
                                          topByField(liveStatsList, "goal")[0]
                                            .goal
                                        }{" "}
                                        bàn
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-white/60">
                                      Chưa có dữ liệu bàn thắng.
                                    </p>
                                  )}
                                </div>
                                <div className="space-y-3">
                                  <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 text-indigo-100 px-3 py-1 text-xs font-semibold">
                                    VUA KIẾN TẠO
                                  </div>
                                  {topByField(liveStatsList, "assist")[0] ? (
                                    <div>
                                      <h3 className="text-2xl font-black">
                                        {members.get(
                                          topByField(liveStatsList, "assist")[0]
                                            .memberId
                                        ) || "Không rõ"}
                                      </h3>
                                      <p className="text-sm text-white/70">
                                        {
                                          topByField(liveStatsList, "assist")[0]
                                            .assist
                                        }{" "}
                                        kiến tạo
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-white/60">
                                      Chưa có dữ liệu kiến tạo.
                                    </p>
                                  )}
                                </div>
                              </div>
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
                        {(selectedMatch?.totalAmount || 0).toLocaleString()} VND
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
                <Card className="shadow-card mb-6">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle className="text-sm font-medium">
                        Công khai đánh giá
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        Cho phép hiển thị MVP và điểm đánh giá trên trang public
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor="ratings-published-toggle"
                        className="text-sm font-normal cursor-pointer"
                      >
                        {selectedMatch?.ratingsPublished
                          ? "Đã công khai"
                          : "Đang ẩn"}
                      </Label>
                      <Switch
                        id="ratings-published-toggle"
                        checked={selectedMatch?.ratingsPublished || false}
                        onCheckedChange={handleToggleRatingsPublished}
                      />
                    </div>
                  </CardHeader>
                </Card>
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
                                {share.status === "PENDING" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleMarkAsPaid(share.id)}
                                  >
                                    Đã trả
                                  </Button>
                                )}
                                {share.status === "PAID" && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleMarkAsUnpaid(share.id)}
                                  >
                                    Chưa trả
                                  </Button>
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
