import { hasFeature } from "@/lib/features";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Check,
  ChevronsUpDown,
  MoreHorizontal,
  Copy,
  Link as LinkIcon,
  ExternalLink,
  QrCode,
  CreditCard,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  collection,
  collectionGroup,
  query as cq,
  where,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  writeBatch,
  Timestamp,
  deleteField,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn, MATCH_TZ, formatMatchDateTime } from "@/lib/utils";
import { aggregateLiveStats, AggregatedStat } from "@/lib/liveStats";
import { useActionConfigs } from "@/hooks/useActionConfigs";
import { postApiJson, apiRequest } from "@/lib/api";
import html2canvas from "html2canvas";
import { MatchScheduleModal } from "@/components/matches/MatchScheduleModal";

interface Match {
  id: string;
  date: Timestamp | string;
  totalAmount: number;
  expenseItems?: {
    id: string;
    description: string;
    amount: number;
    exemptMemberIds: string[];
  }[];
  status: "PENDING" | "COMPLETED" | "PUBLISHED";
  wasPublished?: boolean;
  publishedAt?: Timestamp | string | null;
  isDeleted?: boolean;
  isTest?: boolean;
  ratingsPublished?: boolean;
  venueName?: string;
  paidByMemberId?: string | null;
  payoutStatus?: "COLLECTING" | "READY_FOR_PAYOUT" | "PAID_OUT";
  paidOutAt?: Timestamp | string | null;
  paidOutBy?: string | null;
  payoutNote?: string | null;
  teamNames?: { [key: string]: string };
  teamsConfig?: {
    id: string;
    name: string;
    members?: { id: string }[];
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
  expenseBreakdown?: {
    expenseId: string;
    description: string;
    amount: number;
  }[];
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

interface AdminRating {
  memberId: string;
  score: number;
  notes?: string;
  updatedAt?: Timestamp;
}

type CombinedRatingData = RatingData & {
  adminScore: number;
  hasAdminScore: boolean;
  finalScore: number;
};

interface MvpData {
  mvpId: string;
  mvpName: string;
  voteCount: number;
  votedBy: string[];
}

interface AttendanceRecord {
  timestamp: Timestamp;
  memberName: string;
  userAgent: string;
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
    if (match.status === "PENDING") {
      setStats({ paidAmount: 0, paidCount: 0, totalShares: 0, isLoading: false });
      return;
    }
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
  }, [match.id, match.status]);

  const date = formatMatchDateTime(match.date);

  const isFullyPaid =
    !stats.isLoading &&
    stats.totalShares > 0 &&
    stats.paidCount === stats.totalShares;

  const isPaidOut = match.payoutStatus === "PAID_OUT";
  const isReadyForPayout =
    !isPaidOut &&
    (isFullyPaid ||
      stats.paidAmount >= match.totalAmount ||
      match.payoutStatus === "READY_FOR_PAYOUT");

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg transition-colors",
        isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
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
            {match.status === "PENDING" ? (
              <p className="text-xs opacity-75 italic">
                Đang điểm danh (chưa chốt bill)
              </p>
            ) : (
              <>
                <p className="text-sm opacity-80">
                  Đã thu: {stats.paidAmount.toLocaleString()} VND
                </p>
                <p className="text-sm opacity-80">
                  Hoàn thành: {stats.paidCount}/{stats.totalShares}
                </p>
              </>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {isPaidOut ? (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 h-4 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
                isSelected && "border-white/50 text-white bg-white/20",
              )}
            >
              ✓ Đã hoàn tiền ứng
            </Badge>
          ) : isReadyForPayout ? (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 h-4 border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10",
                isSelected && "border-white/50 text-white bg-white/20",
              )}
            >
              ⚡ Chờ hoàn tiền
            </Badge>
          ) : match.status === "PENDING" ? (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 h-4 border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10",
                isSelected && "border-white/50 text-white bg-white/20",
              )}
            >
              Đang điểm danh
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10",
                isSelected && "border-white/50 text-white bg-white/20",
              )}
            >
              Đang thu tiền
            </Badge>
          )}
        </div>
      </button>
      <div className="flex items-center flex-shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "rounded-full w-8 h-8",
                isSelected
                  ? "hover:bg-primary-foreground/10 text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Sửa / Tính tiền</p>
          </TooltipContent>
        </Tooltip>
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
                      : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
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
  const { groupId, group } = useGroup();
  const groupPath = useGroupPath();
  const [matches, setMatches] = useState<Match[]>([]);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PAID" | "PENDING">(
    "ALL",
  );
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [matchIdToDelete, setMatchIdToDelete] = useState<string | null>(null);
  const [sendNotificationOnDelete, setSendNotificationOnDelete] =
    useState(false);
  const [highlightedShareId, setHighlightedShareId] = useState<string | null>(
    null,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [playerRatings, setPlayerRatings] = useState<Map<string, RatingData>>(
    new Map(),
  );
  const [adminRatings, setAdminRatings] = useState<Map<string, AdminRating>>(
    new Map(),
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
    new Map(),
  );
  const [isLoadingLiveStats, setIsLoadingLiveStats] = useState(false);
  const [isLiveStatsDialogOpen, setIsLiveStatsDialogOpen] = useState(false);
  const [isRatingsDialogOpen, setIsRatingsDialogOpen] = useState(false);
  const [isPosterDialogOpen, setIsPosterDialogOpen] = useState(false);
  const [payoutFilter, setPayoutFilter] = useState<
    "ALL" | "UNPAID" | "PAID_OUT"
  >("ALL");
  const [payoutSettings, setPayoutSettings] = useState<{
    bankBin?: string;
    bankName?: string;
    accountNumber?: string;
    accountHolder?: string;
    qrCodeUrl?: string;
  } | null>(null);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [isUpdatingPayout, setIsUpdatingPayout] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (typeof apiRequest === "function") {
      apiRequest("GET", `/groups/${groupId}/settings/payout`)
        .then((data) => {
          if (!cancelled && data) setPayoutSettings(data);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const handleUpdatePayoutStatus = async (
    status: "PAID_OUT" | "COLLECTING",
  ) => {
    if (!selectedMatchId) return;
    setIsUpdatingPayout(true);
    try {
      await apiRequest(
        "POST",
        `/groups/${groupId}/matches/${selectedMatchId}/payout`,
        {
          payoutStatus: status,
          note: status === "PAID_OUT" ? "Đã chuyển khoản hoàn tiền sân" : "",
        },
      );
      toast({
        title:
          status === "PAID_OUT"
            ? "Đã xác nhận hoàn tiền!"
            : "Đã hoàn tác trạng thái",
        description:
          status === "PAID_OUT"
            ? "Trận đấu đã được đánh dấu là Đã hoàn tiền ứng."
            : "Trận đấu chuyển về trạng thái đang thu tiền.",
      });
      setMatches((current) =>
        current.map((m) =>
          m.id === selectedMatchId
            ? {
                ...m,
                payoutStatus: status,
                paidOutAt:
                  status === "PAID_OUT" ? new Date().toISOString() : null,
              }
            : m,
        ),
      );
      setIsPayoutModalOpen(false);
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi cập nhật",
        description: "Không thể cập nhật trạng thái hoàn tiền.",
      });
    } finally {
      setIsUpdatingPayout(false);
    }
  };

  const displayedMatches = useMemo(() => {
    if (payoutFilter === "PAID_OUT")
      return matches.filter((m) => m.payoutStatus === "PAID_OUT");
    if (payoutFilter === "UNPAID")
      return matches.filter((m) => m.payoutStatus !== "PAID_OUT");
    return matches;
  }, [matches, payoutFilter]);

  const unpaidCount = useMemo(
    () => matches.filter((m) => m.payoutStatus !== "PAID_OUT").length,
    [matches],
  );
  const paidOutCount = useMemo(
    () => matches.filter((m) => m.payoutStatus === "PAID_OUT").length,
    [matches],
  );
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [pendingSharesMap, setPendingSharesMap] = useState<
    Map<
      string,
      {
        shareId: string;
        matchId: string;
        matchDate: string;
        memberId: string;
        memberName: string;
        teamName: string;
        amount: number;
      }[]
    >
  >(new Map());
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const debtModalContentRef = useRef<HTMLDivElement>(null);
  const debtScreenshotRef = useRef<HTMLDivElement>(null);

  // Attendance state
  const [attendance, setAttendance] = useState<Map<string, AttendanceRecord>>(
    new Map(),
  );
  const [isLoadingAttendance, setIsLoadingAttendance] = useState(false);
  const [isAttendanceDialogOpen, setIsAttendanceDialogOpen] = useState(false);
  const [manualAddPopoverOpen, setManualAddPopoverOpen] = useState(false);
  const [raterPopoverOpen, setRaterPopoverOpen] = useState(false);
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
    [labelMap],
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
        const membersSnapshot = await getDocs(
          query(collection(db, "members"), where("groupId", "==", groupId)),
        );
        const membersMap = new Map(
          membersSnapshot.docs.map((doc) => [
            doc.id,
            doc.data().name as string,
          ]),
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
  }, [groupId]);

  useEffect(() => {
    setIsLoadingMatches(true);
    const matchesQuery = query(
      collection(db, "matches"),
      where("groupId", "==", groupId),
      orderBy("date", "desc"),
    );
    const unsubscribe = onSnapshot(
      matchesQuery,
      (querySnapshot) => {
        const matchesList = querySnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }) as Match)
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
      },
    );
    return () => unsubscribe();
  }, [searchParams, selectedMatchId, groupId]);

  useEffect(() => {
    if (!selectedMatchId) return;
    setIsLoadingShares(true);

    const sharesQuery = query(
      collection(db, "matches", selectedMatchId, "shares"),
      orderBy("createdAt", "desc"),
    );
    const unsubscribeShares = onSnapshot(sharesQuery, (querySnapshot) => {
      const currentMatch = matches.find((m) => m.id === selectedMatchId);
      let teamNames: { [key: string]: string } = {};
      if (currentMatch?.teamsConfig) {
        teamNames = currentMatch.teamsConfig.reduce(
          (acc, team) => {
            acc[team.id] = team.name;
            return acc;
          },
          {} as { [key: string]: string },
        );
      } else if (currentMatch?.teamNames) {
        teamNames = currentMatch.teamNames;
      }

      const sharesList = querySnapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
            teamName:
              doc.data().teamId === "pool" || doc.data().teamId === "sponsor"
                ? "Trợ giá / Thu riêng"
                : teamNames[doc.data().teamId] || `Đội ${doc.data().teamId}`,
          }) as Share,
      );
      setShares(sharesList);
      setIsLoadingShares(false);
    });

    const ratingsQuery = query(
      collection(db, "matches", selectedMatchId, "ratings"),
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
          },
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
          },
        );
      });

      setCrossRatings(ratingsByRater);
      setSelectedRaterId(null); // Reset rater selection on match change
      setIsLoadingRatings(false);
    });

    const adminRatingsQuery = query(
      collection(db, "matches", selectedMatchId, "adminRatings"),
    );
    const unsubscribeAdminRatings = onSnapshot(
      adminRatingsQuery,
      (snapshot) => {
        const map = new Map<string, AdminRating>();
        snapshot.forEach((docSnap) => {
          map.set(docSnap.id, {
            memberId: docSnap.id,
            ...(docSnap.data() as AdminRating),
          });
        });
        setAdminRatings(map);
      },
    );

    return () => {
      unsubscribeShares();
      unsubscribeRatings();
      unsubscribeAdminRatings();
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
      orderBy("createdAt", "desc"),
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
      },
    );
    return () => unsubscribeLive();
  }, [selectedMatchId, weights]);

  // Attendance subscription
  useEffect(() => {
    if (!selectedMatchId) {
      setAttendance(new Map());
      return;
    }

    setIsLoadingAttendance(true);
    const attendanceQuery = query(
      collection(db, "matches", selectedMatchId, "attendance"),
      orderBy("timestamp", "desc"),
    );

    const unsubscribe = onSnapshot(
      attendanceQuery,
      (snapshot) => {
        const newAttendance = new Map<string, AttendanceRecord>();
        snapshot.forEach((doc) => {
          newAttendance.set(doc.id, doc.data() as AttendanceRecord);
        });
        setAttendance(newAttendance);
        setIsLoadingAttendance(false);
      },
      (error) => {
        console.error("Error fetching attendance:", error);
        setIsLoadingAttendance(false);
      },
    );

    return () => unsubscribe();
  }, [selectedMatchId]);

  const [manualAddMemberId, setManualAddMemberId] = useState<string>("");

  const handleAddAttendance = async () => {
    if (!selectedMatchId || !manualAddMemberId) return;

    try {
      const memberName = members.get(manualAddMemberId) || "Unknown";
      await setDoc(
        doc(db, "matches", selectedMatchId, "attendance", manualAddMemberId),
        {
          timestamp: serverTimestamp(),
          memberName: memberName,
          userAgent: "Admin Manual Add",
        },
      );
      toast({
        title: "Thành công",
        description: `Đã thêm điểm danh cho ${memberName}.`,
      });
      setManualAddMemberId("");
    } catch (error) {
      console.error("Error adding attendance:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể thêm điểm danh.",
      });
    }
  };

  const handleDeleteAttendance = async (
    memberId: string,
    memberName: string,
  ) => {
    if (!selectedMatchId) return;

    // Simple confirm
    if (!window.confirm(`Bạn có chắc muốn hủy điểm danh cho ${memberName}?`)) {
      return;
    }

    try {
      await deleteDoc(
        doc(db, "matches", selectedMatchId, "attendance", memberId),
      );
      toast({
        title: "Thành công",
        description: `Đã hủy điểm danh cho ${memberName}.`,
      });
    } catch (error) {
      console.error("Error deleting attendance:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể hủy điểm danh.",
      });
    }
  };

  const handleDeleteMatch = async () => {
    if (!matchIdToDelete) return;
    setIsDeleting(true);
    try {
      const deletingMatch = matches.find((m) => m.id === matchIdToDelete);
      const matchDateObj = deletingMatch?.date
        ? typeof deletingMatch.date === "string"
          ? new Date(deletingMatch.date)
          : typeof (deletingMatch.date as any).toDate === "function"
            ? (deletingMatch.date as any).toDate()
            : new Date(deletingMatch.date)
        : null;
      const isPastMatch = matchDateObj
        ? matchDateObj.getTime() < Date.now()
        : false;

      // Chỉ gửi thông báo nếu người dùng chủ động tích chọn VÀ trận chưa qua ngày
      if (
        sendNotificationOnDelete &&
        !isPastMatch &&
        deletingMatch?.status === "PENDING"
      ) {
        postApiJson("/notify/attendance-deleted", {
          matchId: matchIdToDelete,
          groupId,
        }).catch((err) =>
          console.error("Failed to send delete attendance notification", err),
        );
      }
      const batch = writeBatch(db);
      const sharesSnapshot = await getDocs(
        collection(db, "matches", matchIdToDelete, "shares"),
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
          (m) => m.id !== matchIdToDelete,
        );
        setSelectedMatchId(
          remainingMatches.length > 0 ? remainingMatches[0].id : null,
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

  const fetchPendingSharesAcrossAllMatches = useCallback(async () => {
    setIsLoadingPending(true);
    try {
      const q = cq(
        collectionGroup(db, "shares"),
        where("groupId", "==", groupId),
        where("status", "==", "PENDING"),
      );
      const snap = await getDocs(q);
      const map = new Map<
        string,
        {
          shareId: string;
          matchId: string;
          matchDate: string;
          memberId: string;
          memberName: string;
          teamName: string;
          amount: number;
        }[]
      >();

      snap.forEach((docSnap) => {
        const parentPath = docSnap.ref.parent.parent?.id;
        if (!parentPath || parentPath === "matches") return;
        const match = matches.find((m) => m.id === parentPath);
        const matchDate = match ? formatMatchDateTime(match.date) : parentPath;
        const data = docSnap.data();
        const entry = {
          shareId: docSnap.id,
          matchId: parentPath,
          matchDate,
          memberId: data.memberId,
          memberName: members.get(data.memberId) || "Không rõ",
          teamName: data.teamName || `Đội ${data.teamId}`,
          amount: data.amount,
        };
        const key = data.memberId;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(entry);
      });

      setPendingSharesMap(map);
    } catch (err) {
      console.error("fetchPendingSharesAcrossAllMatches error", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description:
          "Không thể tải danh sách nợ. Có thể cần tạo Firestore index.",
      });
    } finally {
      setIsLoadingPending(false);
    }
  }, [matches, members, groupId]);

  const handleMarkPaidFromModal = async (shareId: string, matchId: string) => {
    try {
      await updateDoc(doc(db, "matches", matchId, "shares", shareId), {
        status: "PAID",
        paidAt: new Date().toISOString(),
        channel: "MANUAL",
      });
      await fetchPendingSharesAcrossAllMatches();
      toast({
        title: "Thành công",
        description: "Đã cập nhật trạng thái thanh toán.",
      });
    } catch (err) {
      console.error("handleMarkPaidFromModal error", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái.",
      });
    }
  };

  const handleScreenshotDebtModal = async () => {
    if (pendingSharesMap.size === 0) return;
    const screenshotEl = debtScreenshotRef.current;
    if (!screenshotEl) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không tìm thấy nội dung để chụp.",
      });
      return;
    }
    try {
      const canvas = await html2canvas(screenshotEl, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
        windowWidth: screenshotEl.scrollWidth,
        windowHeight: screenshotEl.scrollHeight,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          toast({
            title: "Thành công",
            description: "Đã copy screenshot vào clipboard!",
          });
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `debt-list-${new Date().toISOString().slice(0, 10)}.png`;
          a.click();
          URL.revokeObjectURL(url);
          toast({
            title: "Đã tải ảnh xuống",
            description: "Clipboard API không khả dụng, đã tải ảnh thay thế.",
          });
        }
      }, "image/png");
    } catch (err) {
      console.error("handleScreenshotDebtModal error", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể chụp ảnh.",
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
    return formatMatchDateTime(selectedMatch.date);
  }, [selectedMatch]);

  const combinedRatings = useMemo<Map<string, CombinedRatingData>>(() => {
    const merged = new Map<string, CombinedRatingData>();

    playerRatings.forEach((data, memberId) => {
      const peerScore = Number.isFinite(data.averageScore)
        ? data.averageScore
        : 0;
      const adminScore = adminRatings.get(memberId)?.score ?? 0;
      merged.set(memberId, {
        ...data,
        averageScore: peerScore,
        adminScore,
        hasAdminScore: adminRatings.has(memberId),
        finalScore: Math.min(peerScore + adminScore, 10),
      });
    });

    adminRatings.forEach((data, memberId) => {
      if (merged.has(memberId)) return;
      const adminScore = data.score ?? 0;
      merged.set(memberId, {
        averageScore: 0,
        totalPoints: 0,
        ratingCount: 0,
        details: [],
        adminScore,
        hasAdminScore: true,
        finalScore: Math.min(adminScore, 10),
      });
    });

    return merged;
  }, [adminRatings, playerRatings]);

  const topMvp = useMemo(() => {
    if (mvpData.length === 0) return null;
    return mvpData[0];
  }, [mvpData]);

  const topScorers = useMemo(() => {
    if (combinedRatings.size === 0) return [];
    const sorted = Array.from(combinedRatings.entries()).sort(
      ([, a], [, b]) => b.finalScore - a.finalScore,
    );
    const topScore = sorted[0][1].finalScore;
    return sorted
      .filter(
        ([, ratingData]) => Math.abs(ratingData.finalScore - topScore) < 1e-9,
      )
      .map(([memberId, ratingData]) => {
        const shareInfo = shares.find((s) => s.memberId === memberId);
        return {
          memberId,
          name: members.get(memberId) || "Không rõ",
          teamName: shareInfo?.teamName || "N/A",
          finalScore: ratingData.finalScore,
          peerScore: ratingData.averageScore,
          adminScore: ratingData.adminScore,
          hasAdminScore: ratingData.hasAdminScore,
          ratingCount: ratingData.ratingCount,
        };
      });
  }, [combinedRatings, members, shares]);

  const topScorerIds = useMemo(
    () => new Set(topScorers.map((s) => s.memberId)),
    [topScorers],
  );

  const liveStatsList = useMemo(() => {
    return Array.from(liveStatsMap.values())
      .filter(
        (s) =>
          s.total > 0 || s.foul > 0 || s.yellow > 0 || s.red > 0 || s.note > 0,
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
      return found.teamsConfig.reduce(
        (acc, t) => {
          acc[t.id] = t.name;
          return acc;
        },
        {} as Record<string, string>,
      );
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
      new Set(liveStatsList.map((s) => s.primaryScore)),
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
      field: keyof AggregatedStat,
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
    [],
  );

  const topGoalLeaders = useMemo(() => {
    const sorted = topByField(liveStatsList, "goal");
    const topValue = sorted[0]?.goal ?? 0;
    if (topValue <= 0) return [];
    return sorted.filter((stat) => stat.goal === topValue);
  }, [liveStatsList, topByField]);

  const topAssistLeaders = useMemo(() => {
    const sorted = topByField(liveStatsList, "assist");
    const topValue = sorted[0]?.assist ?? 0;
    if (topValue <= 0) return [];
    return sorted.filter((stat) => stat.assist === topValue);
  }, [liveStatsList, topByField]);

  const copyLink = useCallback((link: string, message: string) => {
    navigator.clipboard.writeText(link);
    toast({ title: "Đã sao chép!", description: message });
  }, []);

  const handleUpdateMatchStatus = useCallback(
    async (newStatus: "PUBLISHED" | "COMPLETED") => {
      if (!selectedMatchId || !selectedMatch) return;
      const matchRef = doc(db, "matches", selectedMatchId);
      try {
        const isAlreadyPublished = Boolean(
          selectedMatch.wasPublished || selectedMatch.publishedAt,
        );
        const updateData: Record<string, any> = { status: newStatus };
        if (newStatus === "PUBLISHED" && !isAlreadyPublished) {
          updateData.wasPublished = true;
          updateData.publishedAt = serverTimestamp();
        }
        await updateDoc(matchRef, updateData);
        toast({
          title: "Thành công",
          description: `Đã cập nhật trạng thái trận đấu thành ${
            newStatus === "PUBLISHED" ? "Công khai" : "Đã tính tiền"
          }.`,
        });

        // Fire Slack + push notification ONLY when published for the first time
        if (newStatus === "PUBLISHED" && !isAlreadyPublished) {
          postApiJson("/notify/match-published", {
            matchId: selectedMatchId,
            groupId,
          }).catch((err) =>
            console.error("Failed to send match-published notification", err),
          );
        }
      } catch (error) {
        console.error("Error updating match status:", error);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể cập nhật trạng thái trận đấu.",
        });
      }
    },
    [selectedMatchId, selectedMatch, groupId],
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
    [selectedMatchId],
  );

  return (
    <div className="h-full min-h-0">
      <div className="mx-auto flex h-full min-h-0 max-w-7xl flex-col gap-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-foreground">
            Quản lý Trận đấu
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => navigate(groupPath("admin/setup"))}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Tạo trận đấu mới
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsScheduleModalOpen(true)}
              className="gap-1.5"
            >
              <Calendar className="mr-2 h-4 w-4" />
              Lịch tự động & Mẫu
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsDebtModalOpen(true);
                fetchPendingSharesAcrossAllMatches();
              }}
            >
              <DollarSign className="mr-2 h-4 w-4" />
              Nợ chưa trả
            </Button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,30%)_minmax(0,1fr)] gap-4 lg:grid-cols-12 lg:grid-rows-1">
          <div className="min-h-0 min-w-0 lg:col-span-4 xl:col-span-3">
            <Card className="flex h-full min-h-0 flex-col shadow-card">
              <CardHeader className="shrink-0 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Danh sách trận đấu
                  </CardTitle>
                </div>
                <Select
                  value={payoutFilter}
                  onValueChange={(val: any) => setPayoutFilter(val)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Lọc trạng thái hoàn tiền" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">
                      Tất cả trận ({matches.length})
                    </SelectItem>
                    <SelectItem value="UNPAID">
                      Chưa hoàn tiền ({unpaidCount})
                    </SelectItem>
                    <SelectItem value="PAID_OUT">
                      Đã hoàn tiền ({paidOutCount})
                    </SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-0"
                role="region"
                aria-label="Danh sách trận đấu"
                tabIndex={0}
              >
                {isLoadingMatches ? (
                  <div className="p-6 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : displayedMatches.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    Không có trận đấu nào trong bộ lọc này.
                  </div>
                ) : (
                  <AlertDialog
                    open={!!matchIdToDelete}
                    onOpenChange={(isOpen) => {
                      if (!isOpen) {
                        setMatchIdToDelete(null);
                        setSendNotificationOnDelete(false);
                      }
                    }}
                  >
                    <div className="space-y-1 p-2">
                      {displayedMatches.map((match) => (
                        <MatchListItem
                          key={match.id}
                          match={match}
                          isSelected={selectedMatchId === match.id}
                          onSelect={() => setSelectedMatchId(match.id)}
                          onDelete={() => {
                            setSendNotificationOnDelete(false);
                            setMatchIdToDelete(match.id);
                          }}
                          onEdit={() =>
                            navigate(groupPath(`admin/setup/${match.id}`))
                          }
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

                      {(() => {
                        const targetMatch = matches.find(
                          (m) => m.id === matchIdToDelete,
                        );
                        if (!targetMatch) return null;
                        const matchDateObj = targetMatch.date
                          ? typeof targetMatch.date === "string"
                            ? new Date(targetMatch.date)
                            : typeof (targetMatch.date as any).toDate ===
                                "function"
                              ? (targetMatch.date as any).toDate()
                              : new Date(targetMatch.date)
                          : null;
                        const isPast = matchDateObj
                          ? matchDateObj.getTime() < Date.now()
                          : false;

                        return (
                          <div className="py-2 text-xs text-muted-foreground border-y my-1 space-y-1.5">
                            <p>
                              Trận:{" "}
                              <strong className="text-foreground">
                                {formatMatchDateTime(targetMatch.date)}
                              </strong>
                            </p>
                            {isPast ? (
                              <p className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                                💡 Trận đấu trong quá khứ — hệ thống sẽ không gửi thông báo hủy.
                              </p>
                            ) : targetMatch.status === "PENDING" ? (
                              <div className="flex items-center space-x-2 pt-1">
                                <Checkbox
                                  id="notify-delete"
                                  checked={sendNotificationOnDelete}
                                  onCheckedChange={(checked) =>
                                    setSendNotificationOnDelete(
                                      Boolean(checked),
                                    )
                                  }
                                />
                                <Label
                                  htmlFor="notify-delete"
                                  className="text-xs text-foreground font-normal cursor-pointer"
                                >
                                  Gửi thông báo hủy trận lên Slack và Push (Mặc định: Tắt)
                                </Label>
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}

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
          <div
            className="min-h-0 min-w-0 overflow-y-auto overscroll-contain lg:col-span-8 xl:col-span-9"
            role="region"
            aria-label="Chi tiết trận đấu"
            tabIndex={0}
          >
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
                <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3 shadow-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status Badge */}
                    {selectedMatch.status === "PUBLISHED" ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1.5 py-1 px-2.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        Đã công khai
                      </Badge>
                    ) : selectedMatch.status === "COMPLETED" ? (
                      <Badge
                        variant="outline"
                        className="text-amber-700 dark:text-amber-400 bg-amber-500/15 border-amber-500/30 gap-1.5 py-1 px-2.5"
                      >
                        <Calculator className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        Đã tính tiền
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-blue-700 dark:text-blue-400 bg-blue-500/15 border-blue-500/30 gap-1.5 py-1 px-2.5"
                      >
                        <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        Đang điểm danh
                      </Badge>
                    )}

                    {/* Publish / Unpublish Button */}
                    {selectedMatch?.status !== "PUBLISHED" ? (
                      <Button
                        onClick={() => handleUpdateMatchStatus("PUBLISHED")}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                        size="sm"
                      >
                        <Send className="h-4 w-4 mr-1.5" />
                        Công khai bill
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleUpdateMatchStatus("COMPLETED")}
                        variant="outline"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Hủy công khai
                      </Button>
                    )}

                    {/* Edit & Calculate */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(groupPath(`admin/setup/${selectedMatch.id}`))
                      }
                    >
                      <Pencil className="h-4 w-4 mr-1.5" />
                      Sửa / Tính tiền
                    </Button>

                    {/* Attendance Dialog */}
                    <Dialog
                      open={isAttendanceDialogOpen}
                      onOpenChange={setIsAttendanceDialogOpen}
                    >
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Users className="mr-1.5 h-4 w-4" />
                          Điểm danh ({attendance.size})
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>
                            Danh sách điểm danh ({attendance.size})
                          </DialogTitle>
                        </DialogHeader>
                        <div className="max-h-[60vh] overflow-y-auto">
                          {isLoadingAttendance ? (
                            <div className="flex justify-center p-4">
                              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                          ) : attendance.size === 0 ? (
                            <div className="text-center p-4 text-muted-foreground">
                              Chưa có ai điểm danh.
                            </div>
                          ) : (
                            <>
                              <div className="flex gap-2 mb-4">
                                <Popover
                                  open={manualAddPopoverOpen}
                                  onOpenChange={setManualAddPopoverOpen}
                                >
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      aria-expanded={manualAddPopoverOpen}
                                      className="w-full justify-between font-normal"
                                    >
                                      {manualAddMemberId
                                        ? members.get(manualAddMemberId) ||
                                          "Chọn thành viên..."
                                        : "Chọn thành viên..."}
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="w-[var(--radix-popover-trigger-width)] p-0"
                                    align="start"
                                  >
                                    <Command>
                                      <CommandInput placeholder="Tìm thành viên..." />
                                      <CommandList>
                                        <CommandEmpty>
                                          Không tìm thấy thành viên.
                                        </CommandEmpty>
                                        <CommandGroup>
                                          {Array.from(members.entries())
                                            .filter(
                                              ([id]) => !attendance.has(id),
                                            )
                                            .map(([id, name]) => (
                                              <CommandItem
                                                key={id}
                                                value={name}
                                                onSelect={() => {
                                                  setManualAddMemberId(id);
                                                  setManualAddPopoverOpen(
                                                    false,
                                                  );
                                                }}
                                              >
                                                <Check
                                                  className={cn(
                                                    "mr-2 h-4 w-4",
                                                    manualAddMemberId === id
                                                      ? "opacity-100"
                                                      : "opacity-0",
                                                  )}
                                                />
                                                {name}
                                              </CommandItem>
                                            ))}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                                <Button
                                  onClick={handleAddAttendance}
                                  disabled={!manualAddMemberId}
                                >
                                  <PlusCircle className="h-4 w-4" />
                                </Button>
                              </div>

                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Thành viên</TableHead>
                                    <TableHead>Thời gian</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {Array.from(attendance.entries()).map(
                                    ([memberId, record]) => (
                                      <TableRow key={memberId}>
                                        <TableCell className="font-medium">
                                          {record.memberName}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                          {record.timestamp?.seconds
                                            ? new Date(
                                                record.timestamp.seconds * 1000,
                                              ).toLocaleTimeString("vi-VN", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                                timeZone: MATCH_TZ,
                                              })
                                            : "--:--"}
                                        </TableCell>
                                        <TableCell>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            onClick={() =>
                                              handleDeleteAttendance(
                                                memberId,
                                                record.memberName,
                                              )
                                            }
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    ),
                                  )}
                                </TableBody>
                              </Table>
                            </>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Quick Copy Link Button (Contextual based on match status) */}
                    {selectedMatch?.status === "PENDING" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          copyLink(
                            `${window.location.origin}${groupPath("public/attendance")}`,
                            "Link điểm danh đã được sao chép.",
                          )
                        }
                        title="Sao chép link điểm danh gửi thành viên"
                        className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                      >
                        <LinkIcon className="mr-1.5 h-4 w-4" />
                        Link điểm danh
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          copyLink(
                            `${window.location.origin}${groupPath("public/pay")}`,
                            "Link thanh toán chung đã được sao chép.",
                          )
                        }
                        title="Sao chép link thanh toán chung gửi thành viên"
                      >
                        <Copy className="mr-1.5 h-4 w-4" />
                        Link thanh toán
                      </Button>
                    )}

                    {/* Dropdown Menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <MoreHorizontal className="mr-1.5 h-4 w-4" />
                          Xem thêm
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            window.open(
                              `${window.location.origin}${groupPath("public/pay")}`,
                              "_blank",
                            )
                          }
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Mở trang thanh toán (khách)
                        </DropdownMenuItem>
                        {hasFeature(groupId, group, "ratings") && (
                          <DropdownMenuItem
                            onSelect={() => setIsRatingsDialogOpen(true)}
                          >
                            <Star className="mr-2 h-4 w-4" />
                            Xem đánh giá
                          </DropdownMenuItem>
                        )}
                        {hasFeature(groupId, group, "liveNotes") && (
                          <DropdownMenuItem
                            onSelect={() => setIsLiveStatsDialogOpen(true)}
                          >
                            <TrendingUp className="mr-2 h-4 w-4" />
                            Thống kê nhanh
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => setIsPosterDialogOpen(true)}
                        >
                          <Trophy className="mr-2 h-4 w-4" />
                          Vinh danh dạng Poster
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {hasFeature(groupId, group, "ratings") && (
                    <Dialog
                      open={isRatingsDialogOpen}
                      onOpenChange={setIsRatingsDialogOpen}
                    >
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
                                                  "bg-yellow-100 dark:bg-yellow-900/50",
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
                                                      : "text-sm",
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
                                                    "bg-yellow-500 text-white",
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
                                          {showAllMvp
                                            ? "Thu gọn"
                                            : "Xem tất cả"}
                                        </Button>
                                      </div>
                                    )}
                                  </CardContent>
                                </Card>
                              )}
                              {combinedRatings.size > 0 ? (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Hạng</TableHead>
                                      <TableHead>Thành viên</TableHead>
                                      <TableHead>Đội</TableHead>
                                      <TableHead className="text-right">
                                        Peer /5
                                      </TableHead>
                                      <TableHead className="text-right">
                                        Admin /5
                                      </TableHead>
                                      <TableHead className="text-right">
                                        Điểm cuối /10
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {Array.from(combinedRatings.entries())
                                      .sort(
                                        ([, a], [, b]) =>
                                          b.finalScore - a.finalScore,
                                      )
                                      .map(([memberId, ratingData], index) => {
                                        const shareInfo = shares.find(
                                          (s) => s.memberId === memberId,
                                        );
                                        const teamName =
                                          shareInfo?.teamName || "N/A";
                                        const isTopScorer =
                                          topScorerIds.has(memberId);
                                        const peerScore = Number.isFinite(
                                          ratingData.averageScore,
                                        )
                                          ? ratingData.averageScore
                                          : 0;
                                        return (
                                          <Dialog key={memberId}>
                                            <DialogTrigger asChild>
                                              <TableRow
                                                className={cn(
                                                  "cursor-pointer",
                                                  isTopScorer &&
                                                    "bg-green-100 dark:bg-green-900/50",
                                                )}
                                              >
                                                <TableCell
                                                  className={cn(
                                                    isTopScorer &&
                                                      "font-bold text-lg",
                                                  )}
                                                >
                                                  {index + 1}
                                                </TableCell>
                                                <TableCell
                                                  className={cn(
                                                    "font-medium",
                                                    isTopScorer &&
                                                      "text-lg text-green-600 dark:text-green-400",
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
                                                <TableCell>
                                                  {teamName}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  <Badge variant="outline">
                                                    {peerScore.toFixed(2)}
                                                  </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  {ratingData.hasAdminScore ? (
                                                    <Badge variant="secondary">
                                                      {ratingData.adminScore.toFixed(
                                                        2,
                                                      )}
                                                    </Badge>
                                                  ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                      Chưa chấm
                                                    </span>
                                                  )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  <Badge
                                                    variant={
                                                      isTopScorer
                                                        ? "default"
                                                        : "outline"
                                                    }
                                                    className={cn(
                                                      isTopScorer &&
                                                        "bg-green-500 text-white text-base px-3 py-1",
                                                    )}
                                                  >
                                                    {ratingData.finalScore.toFixed(
                                                      2,
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
                                              <div className="space-y-3">
                                                <div className="flex justify-between text-sm">
                                                  <span>Điểm peer</span>
                                                  <strong>
                                                    {peerScore.toFixed(2)} / 5
                                                  </strong>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                  <span>Điểm admin</span>
                                                  <strong>
                                                    {ratingData.hasAdminScore
                                                      ? `${ratingData.adminScore.toFixed(
                                                          2,
                                                        )} / 5`
                                                      : "Chưa chấm"}
                                                  </strong>
                                                </div>
                                                <div className="flex justify-between text-sm items-center">
                                                  <span>Tổng</span>
                                                  <Badge>
                                                    {ratingData.finalScore.toFixed(
                                                      2,
                                                    )}{" "}
                                                    / 10
                                                  </Badge>
                                                </div>
                                                <div>
                                                  <p className="text-xs text-muted-foreground mb-2">
                                                    Chi tiết điểm peer:
                                                  </p>
                                                  <ul className="text-sm space-y-2 max-h-60 overflow-y-auto">
                                                    {ratingData.details.length >
                                                    0 ? (
                                                      ratingData.details.map(
                                                        (d, i) => (
                                                          <li
                                                            key={i}
                                                            className="flex justify-between"
                                                          >
                                                            <span>
                                                              {d.ratedBy}
                                                            </span>
                                                            <strong>
                                                              {d.score} điểm
                                                            </strong>
                                                          </li>
                                                        ),
                                                      )
                                                    ) : (
                                                      <li className="text-xs text-muted-foreground">
                                                        Chưa có đánh giá peer.
                                                      </li>
                                                    )}
                                                  </ul>
                                                </div>
                                              </div>
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
                                    <Popover
                                      open={raterPopoverOpen}
                                      onOpenChange={setRaterPopoverOpen}
                                    >
                                      <PopoverTrigger asChild>
                                        <Button
                                          variant="outline"
                                          role="combobox"
                                          aria-expanded={raterPopoverOpen}
                                          className="w-full justify-between font-normal"
                                        >
                                          {selectedRaterId
                                            ? crossRatings.get(selectedRaterId)
                                                ?.ratedByName ||
                                              "Chọn người đánh giá để xem điểm"
                                            : "Chọn người đánh giá để xem điểm"}
                                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent
                                        className="w-[var(--radix-popover-trigger-width)] p-0"
                                        align="start"
                                      >
                                        <Command>
                                          <CommandInput placeholder="Tìm người đánh giá..." />
                                          <CommandList>
                                            <CommandEmpty>
                                              Không tìm thấy người đánh giá.
                                            </CommandEmpty>
                                            <CommandGroup>
                                              {Array.from(
                                                crossRatings.entries(),
                                              ).map(([raterId, data]) => (
                                                <CommandItem
                                                  key={raterId}
                                                  value={data.ratedByName}
                                                  onSelect={() => {
                                                    setSelectedRaterId(raterId);
                                                    setRaterPopoverOpen(false);
                                                  }}
                                                >
                                                  <Check
                                                    className={cn(
                                                      "mr-2 h-4 w-4",
                                                      selectedRaterId ===
                                                        raterId
                                                        ? "opacity-100"
                                                        : "opacity-0",
                                                    )}
                                                  />
                                                  {data.ratedByName}
                                                </CommandItem>
                                              ))}
                                            </CommandGroup>
                                          </CommandList>
                                        </Command>
                                      </PopoverContent>
                                    </Popover>
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
                                                (a, b) => b.score - a.score,
                                              )
                                              .map(
                                                ({ playerRatedId, score }) => (
                                                  <TableRow key={playerRatedId}>
                                                    <TableCell className="font-medium">
                                                      {members.get(
                                                        playerRatedId,
                                                      ) || "Không rõ"}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold">
                                                      {score}
                                                    </TableCell>
                                                  </TableRow>
                                                ),
                                              )}
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
                  )}
                  {hasFeature(groupId, group, "liveNotes") && (
                    <Dialog
                      open={isLiveStatsDialogOpen}
                      onOpenChange={setIsLiveStatsDialogOpen}
                    >
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
                                <div
                                  className={`grid gap-2 mb-3 ${Object.keys(currentTeamNames).length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}
                                >
                                  {Object.entries(currentTeamNames).map(
                                    ([teamId, teamName]) => (
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
                                    ),
                                  )}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                {liveStatsList.map((stats) => {
                                  const medal = medalClassForScore(
                                    stats.primaryScore,
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
                                        medalClass,
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
                                            {labelFor("save_gk")}{" "}
                                            {stats.save_gk}
                                          </Badge>
                                        )}
                                        {stats.tackle > 0 && (
                                          <Badge className="bg-indigo-100 text-indigo-700 cursor-default">
                                            {labelFor("tackle")} {stats.tackle}
                                          </Badge>
                                        )}
                                        {stats.dribble > 0 && (
                                          <Badge className="bg-purple-100 text-purple-700 cursor-default">
                                            {labelFor("dribble")}{" "}
                                            {stats.dribble}
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
                  )}
                  <Dialog
                    open={isPosterDialogOpen}
                    onOpenChange={setIsPosterDialogOpen}
                  >
                    <DialogContent className="max-w-5xl p-0 overflow-hidden border-0 shadow-2xl">
                      {!topMvp && topScorers.length === 0 ? (
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
                              {topScorers.length > 0 ? (
                                <div className="relative space-y-4">
                                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-400/20 text-emerald-100 px-3 py-1 text-xs font-semibold">
                                    MVP (ĐIỂM CAO NHẤT)
                                    {topScorers.length > 1 && " · Đồng MVP"}
                                  </div>
                                  <h3 className="text-3xl font-black">
                                    {topScorers.map((s) => s.name).join(", ")}
                                  </h3>
                                  <p className="text-sm text-white/70">
                                    {topScorers
                                      .map((s) => s.teamName)
                                      .join(" • ")}
                                  </p>
                                  <div className="text-5xl font-black tracking-tight text-emerald-200">
                                    {topScorers[0].finalScore.toFixed(2)}
                                  </div>
                                  <div className="space-y-1 text-sm text-white/70">
                                    <p>
                                      Peer: {topScorers[0].peerScore.toFixed(2)}{" "}
                                      / 5{" • "}
                                      {topScorers[0].hasAdminScore
                                        ? `Admin: ${topScorers[0].adminScore.toFixed(
                                            2,
                                          )} / 5`
                                        : "Admin: Chưa chấm"}
                                    </p>
                                    <p>
                                      {topScorers[0].ratingCount} lượt đánh giá
                                      peer
                                    </p>
                                  </div>
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
                                  {topGoalLeaders.length > 0 ? (
                                    <div className="space-y-1">
                                      <h3 className="text-2xl font-black leading-tight">
                                        {topGoalLeaders
                                          .map(
                                            (stat) =>
                                              members.get(stat.memberId) ||
                                              "Không rõ",
                                          )
                                          .join(", ")}
                                      </h3>
                                      <p className="text-sm text-white/70">
                                        {topGoalLeaders[0].goal} bàn
                                        {topGoalLeaders.length > 1
                                          ? " (đồng vua phá lưới)"
                                          : ""}
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
                                  {topAssistLeaders.length > 0 ? (
                                    <div className="space-y-1">
                                      <h3 className="text-2xl font-black leading-tight">
                                        {topAssistLeaders
                                          .map(
                                            (stat) =>
                                              members.get(stat.memberId) ||
                                              "Không rõ",
                                          )
                                          .join(", ")}
                                      </h3>
                                      <p className="text-sm text-white/70">
                                        {topAssistLeaders[0].assist} kiến tạo
                                        {topAssistLeaders.length > 1
                                          ? " (đồng vua kiến tạo)"
                                          : ""}
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
                {selectedMatch.status === "PENDING" && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                      <span>
                        Trận đấu đang ở trạng thái điểm danh, chưa được chốt
                        tính tiền chia bill.
                      </span>
                    </div>
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() =>
                        navigate(groupPath(`admin/setup/${selectedMatch.id}`))
                      }
                    >
                      <Calculator className="mr-1.5 h-4 w-4" />
                      Tính tiền ngay
                    </Button>
                  </div>
                )}
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
                        {selectedMatch?.status === "PENDING"
                          ? "Chưa chốt tính tiền chia bill"
                          : `${paidCount}/${totalShares} đã thanh toán`}
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
                        {selectedMatch?.status === "PENDING"
                          ? "Chưa chốt bill"
                          : `${pendingAmount.toLocaleString()} VND`}
                      </div>
                      {selectedMatch?.status === "PENDING" && (
                        <p className="text-xs text-muted-foreground">
                          Dự kiến: {(selectedMatch?.totalAmount || 0).toLocaleString()} VND
                        </p>
                      )}
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
                        {selectedMatch?.status === "PENDING"
                          ? 0
                          : totalAmount > 0
                            ? Math.round((paidAmount / totalAmount) * 100)
                            : 0}
                        %
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <Card className="shadow-card mb-6 bg-muted/30">
                  <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                      {selectedMatch.venueName && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            Sân:
                          </span>
                          <span className="font-semibold">
                            {selectedMatch.venueName}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-amber-600" />
                        <span className="text-sm text-muted-foreground">
                          Người ứng tiền sân:
                        </span>
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                        >
                          {selectedMatch.paidByMemberId
                            ? members.get(selectedMatch.paidByMemberId) ||
                              "Không rõ"
                            : group?.ownerDisplayName || "Người ứng nhóm"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          Trạng thái hoàn tiền:
                        </span>
                        {selectedMatch.payoutStatus === "PAID_OUT" ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                            ✓ Đã hoàn tiền ứng
                          </Badge>
                        ) : paidAmount >= totalAmount ? (
                          <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30">
                            ⚡ Sẵn sàng hoàn tiền
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                            Đang thu tiền
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsPayoutModalOpen(true)}
                      className="gap-1.5"
                    >
                      <QrCode className="h-4 w-4 text-primary" />
                      Hoàn tiền ứng sân
                    </Button>
                  </CardContent>
                </Card>

                {/* Reimbursement & VietQR Payout Dialog */}
                <Dialog
                  open={isPayoutModalOpen}
                  onOpenChange={setIsPayoutModalOpen}
                >
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                        <DialogTitle>
                          Hoàn tiền ứng sân cho trận đấu
                        </DialogTitle>
                      </div>
                      <DialogDescription>
                        Thông tin tài khoản ngân hàng và mã VietQR để người quản
                        lý hoặc thủ quỹ hoàn trả tiền sân cho người đã ứng.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                      <div className="p-3 bg-muted/40 rounded-lg space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Người ứng tiền:
                          </span>
                          <span className="font-semibold">
                            {selectedMatch?.paidByMemberId
                              ? members.get(selectedMatch.paidByMemberId) ||
                                "Thành viên nhóm"
                              : group?.ownerDisplayName ||
                                "Người ứng tiền nhóm"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Tiền sân cần hoàn:
                          </span>
                          <span className="font-bold text-base text-primary">
                            {selectedMatch?.totalAmount.toLocaleString()} VND
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Tiền đã thu được:
                          </span>
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            {paidAmount.toLocaleString()} VND (
                            {totalAmount > 0
                              ? Math.round((paidAmount / totalAmount) * 100)
                              : 0}
                            %)
                          </span>
                        </div>
                      </div>

                      {payoutSettings?.bankBin &&
                      payoutSettings?.accountNumber ? (
                        <div className="flex flex-col items-center gap-3 p-4 border rounded-xl bg-card">
                          <img
                            src={
                              payoutSettings.qrCodeUrl ||
                              `https://img.vietqr.io/image/${payoutSettings.bankBin}-${payoutSettings.accountNumber}-compact.png?amount=${
                                selectedMatch?.totalAmount || 0
                              }&addInfo=${encodeURIComponent(
                                `HOAN TIEN SAN ${selectedMatch?.id.slice(0, 8)}`,
                              )}&accountName=${encodeURIComponent(payoutSettings.accountHolder || "")}`
                            }
                            alt="VietQR Payout"
                            className="w-48 h-48 object-contain rounded-lg bg-white p-2 border shadow-xs"
                          />
                          <div className="w-full text-center space-y-1">
                            <p className="font-medium text-foreground">
                              {payoutSettings.bankName}
                            </p>
                            <div className="flex items-center justify-center gap-2">
                              <span className="font-mono font-bold text-lg text-primary">
                                {payoutSettings.accountNumber}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Sao chép số tài khoản"
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    payoutSettings.accountNumber || "",
                                  );
                                  toast({ title: "Đã sao chép số tài khoản" });
                                }}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground uppercase">
                              {payoutSettings.accountHolder}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground">
                          <p>
                            Chưa cấu hình tài khoản nhận hoàn tiền cho nhóm.
                          </p>
                          <p className="text-xs mt-1">
                            Vui lòng vào trang <strong>Cấu hình</strong> để cập
                            nhật số tài khoản & VietQR.
                          </p>
                        </div>
                      )}

                      {selectedMatch?.payoutStatus === "PAID_OUT" ? (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-center space-y-2">
                          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4" />
                            Trận đấu này đã được xác nhận hoàn tiền ứng!
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() =>
                              handleUpdatePayoutStatus("COLLECTING")
                            }
                            disabled={isUpdatingPayout}
                          >
                            Hoàn tác trạng thái về Chưa hoàn
                          </Button>
                        </div>
                      ) : (
                        <Button
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => handleUpdatePayoutStatus("PAID_OUT")}
                          disabled={isUpdatingPayout}
                        >
                          {isUpdatingPayout ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                          )}
                          Xác nhận đã chuyển khoản hoàn tiền sân
                        </Button>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setIsPayoutModalOpen(false)}
                      >
                        Đóng
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                {hasFeature(groupId, group, "ratings") && (
                  <Card className="shadow-card mb-6">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <div>
                        <CardTitle className="text-sm font-medium">
                          Công khai đánh giá
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          Cho phép hiển thị MVP và điểm đánh giá trên trang
                          public
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
                )}
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
                          {selectedMatch?.status === "PENDING" ? (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="text-center py-8 text-muted-foreground text-sm"
                              >
                                Trận đấu đang ở trạng thái điểm danh, chưa được chốt tính tiền chia bill.
                              </TableCell>
                            </TableRow>
                          ) : filteredShares.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="text-center py-8 text-muted-foreground text-sm"
                              >
                                Không tìm thấy dữ liệu chia tiền phù hợp.
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredShares.map((share) => (
                            <TableRow
                              key={share.id}
                              className={cn(
                                highlightedShareId === share.id &&
                                  "bg-yellow-200/50 transition-all duration-500",
                              )}
                            >
                              <TableCell className="font-medium">
                                {members.get(share.memberId) || "Không rõ"}
                              </TableCell>
                              <TableCell>
                                {share.teamId === "pool" || share.teamId === "sponsor" ? (
                                  <Badge
                                    variant="outline"
                                    className="text-amber-700 dark:text-amber-300 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 text-xs font-normal"
                                  >
                                    Trợ giá / Thu riêng
                                  </Badge>
                                ) : (
                                  share.teamName
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <div className="font-semibold">
                                    {share.amount.toLocaleString()} VND
                                  </div>
                                  {share.expenseBreakdown &&
                                    share.expenseBreakdown.length > 0 && (
                                      <div className="text-xs text-muted-foreground">
                                        {share.expenseBreakdown.map(
                                          (exp, idx) => (
                                            <div key={idx}>
                                              {exp.description}:{" "}
                                              {exp.amount.toLocaleString()}đ
                                            </div>
                                          ),
                                        )}
                                      </div>
                                    )}
                                </div>
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
                          ))
                        )}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
        <MatchScheduleModal
          isOpen={isScheduleModalOpen}
          onClose={() => setIsScheduleModalOpen(false)}
        />
        <Dialog open={isDebtModalOpen} onOpenChange={setIsDebtModalOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-destructive" />
                  Danh sách nợ chưa trả
                  <Badge variant="destructive">
                    {pendingSharesMap.size} người
                  </Badge>
                </DialogTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleScreenshotDebtModal}
                  disabled={isLoadingPending || pendingSharesMap.size === 0}
                >
                  <ClipboardList className="h-4 w-4 mr-1" />
                  Copy ảnh
                </Button>
              </div>
            </div>
            <div
              ref={debtModalContentRef}
              className="flex-1 overflow-y-auto px-6 pb-6"
            >
              {isLoadingPending ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : pendingSharesMap.size === 0 ? (
                <div className="text-center p-8 text-muted-foreground">
                  Không có ai nợ tiền trận nào.
                </div>
              ) : (
                <div
                  ref={debtScreenshotRef}
                  id="debt-screenshot-portal"
                  className="space-y-3 bg-white p-1"
                >
                  {Array.from(pendingSharesMap.entries())
                    .sort(
                      ([, a], [, b]) =>
                        b.reduce((s, e) => s + e.amount, 0) -
                        a.reduce((s, e) => s + e.amount, 0),
                    )
                    .map(([memberId, entries]) => {
                      const totalDebt = entries.reduce(
                        (s, e) => s + e.amount,
                        0,
                      );
                      return (
                        <Card key={memberId} className="overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 bg-destructive/5 border-b">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center font-bold text-sm">
                                {entries[0].memberName.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold">
                                  {entries[0].memberName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {entries.length} trận chưa trả
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-destructive">
                                {totalDebt.toLocaleString()} VND
                              </p>
                            </div>
                          </div>
                          <div className="divide-y">
                            {entries.map((entry) => (
                              <div
                                key={entry.shareId}
                                className="flex items-center justify-between px-4 py-2"
                              >
                                <div className="flex items-center gap-4">
                                  <div className="text-sm">
                                    <p className="font-medium">
                                      {entry.matchDate}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {entry.teamName}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-medium">
                                    {entry.amount.toLocaleString()} VND
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Card>
                      );
                    })}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Matches;
