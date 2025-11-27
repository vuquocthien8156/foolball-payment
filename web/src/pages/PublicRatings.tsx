import { useState, useEffect, useMemo, useCallback } from "react";
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
  doc,
  getDoc,
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
import { AggregatedStat, aggregateLiveStats } from "@/lib/liveStats";
import { useActionConfigs } from "@/hooks/useActionConfigs";

interface Match {
  id: string;
  date: Timestamp | string;
  totalAmount: number;
  status: "PENDING" | "COMPLETED" | "PUBLISHED";
  isDeleted?: boolean;
  ratingsPublished?: boolean;
  teamNames?: Record<string, string>;
  teamsConfig?: { id: string; name: string; members?: { id: string }[] }[];
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

interface LiveEvent {
  id: string;
  memberId?: string;
  type:
    | "goal"
    | "assist"
    | "yellow"
    | "red"
    | "foul"
    | "save_gk"
    | "tackle"
    | "dribble"
    | "note"
    | string;
  note?: string;
  minute?: number | null;
  second?: number | null;
}

interface AdminRating {
  score: number;
  notes?: string;
}

interface CombinedRatingData extends RatingData {
  adminScore: number;
  finalScore: number;
  hasAdminScore: boolean;
}

const MIN_MVP_VOTES = 2;

const eventLabels: Record<string, string> = {
  goal: "Bàn thắng",
  assist: "Kiến tạo",
  save_gk: "Cản phá GK",
  tackle: "Tackle/Chặn",
  dribble: "Qua người",
  foul: "Phạm lỗi",
  yellow: "Thẻ vàng",
  red: "Thẻ đỏ",
  note: "Ghi chú",
};

const topByField = (
  stats: (AggregatedStat & { name: string })[],
  field: keyof AggregatedStat
) => {
  return stats
    .filter((s) => (s[field] as number) > 0)
    .sort((a, b) => (b[field] as number) - (a[field] as number));
};

const PublicRatings = () => {
  const { labelMap, weights, loading: actionsLoading } = useActionConfigs();
  const labelFor = useCallback(
    (key: string) => labelMap.get(key) || eventLabels[key] || key,
    [labelMap]
  );
  const positiveExtras = useMemo(
    () =>
      new Set(
        (weights.extras || [])
          .filter((ex) => !ex.isNegative)
          .map((ex) => ex.key)
      ),
    [weights.extras]
  );
  const negativeExtras = useMemo(
    () =>
      new Set(
        (weights.extras || [])
          .filter((ex) => ex.isNegative)
          .map((ex) => ex.key)
      ),
    [weights.extras]
  );
  const badgeClassFor = useCallback(
    (key: string) => {
      if (key === "goal") return "bg-emerald-100 text-emerald-700";
      if (key === "assist") return "bg-blue-100 text-blue-700";
      if (key === "save_gk") return "bg-cyan-100 text-cyan-700";
      if (key === "tackle") return "bg-indigo-100 text-indigo-700";
      if (key === "dribble") return "bg-purple-100 text-purple-700";
      if (key === "note") return "bg-slate-100 text-slate-700";
      if (key === "yellow") return "bg-amber-100 text-amber-800";
      if (key === "red") return "bg-red-100 text-red-700";
      if (key === "foul") return "bg-orange-100 text-orange-800";
      if (positiveExtras.has(key)) return "bg-teal-100 text-teal-700";
      if (negativeExtras.has(key)) return "bg-rose-100 text-rose-700";
      return "bg-muted text-foreground";
    },
    [negativeExtras, positiveExtras]
  );
  const [matches, setMatches] = useState<Match[]>([]);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playerRatings, setPlayerRatings] = useState<Map<string, RatingData>>(
    new Map()
  );
  const [adminRatings, setAdminRatings] = useState<Map<string, AdminRating>>(
    new Map()
  );
  const [mvpData, setMvpData] = useState<MvpData[]>([]);
  const [showAllMvp, setShowAllMvp] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveStatsList, setLiveStatsList] = useState<
    (AggregatedStat & { name: string })[]
  >([]);
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [overallStats, setOverallStats] = useState<{
    topRatings: {
      memberId: string;
      memberName: string;
      finalScore: number;
      peerScore: number;
      adminScore: number;
    }[];
    topMvp: { memberId: string; memberName: string; voteCount: number }[];
    isLoading: boolean;
  }>({ topRatings: [], topMvp: [], isLoading: true });
  const [previousWeek, setPreviousWeek] = useState<{
    topRating: {
      memberId: string;
      memberName: string;
      finalScore: number;
      peerScore: number;
      adminScore: number;
    } | null;
    topMvp: { memberId: string; memberName: string; voteCount: number } | null;
    rangeLabel: string;
    isLoading: boolean;
  }>({
    topRating: null,
    topMvp: null,
    rangeLabel: "",
    isLoading: true,
  });
  const [latestMatchDateLabel, setLatestMatchDateLabel] = useState<string>("");
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);
  const [isMatchFullyPaid, setIsMatchFullyPaid] = useState(false);
  const [expandedStats, setExpandedStats] = useState<Set<string>>(new Set());
  const combinedRatings = useMemo<Map<string, CombinedRatingData>>(() => {
    const merged = new Map<string, CombinedRatingData>();

    playerRatings.forEach((data, memberId) => {
      const adminScore = adminRatings.get(memberId)?.score ?? 0;
      const peerScore = Number.isFinite(data.averageScore)
        ? data.averageScore
        : 0;
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
  const topScoreEntry = useMemo(() => {
    if (combinedRatings.size === 0) return null;
    const [memberId, rating] = Array.from(combinedRatings.entries()).sort(
      ([, a], [, b]) => b.finalScore - a.finalScore
    )[0];
    return {
      memberId,
      name: members.get(memberId) || "Không rõ",
      final: rating.finalScore,
      peer: rating.averageScore,
      admin: rating.adminScore,
      hasAdmin: rating.hasAdminScore,
      count: rating.ratingCount,
    };
  }, [combinedRatings, members]);

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
      const list = querySnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Match))
        .filter((m) => !m.isDeleted)
        .sort((a, b) => {
          const dateA =
            typeof a.date === "string" ? new Date(a.date) : a.date.toDate();
          const dateB =
            typeof b.date === "string" ? new Date(b.date) : b.date.toDate();
          return dateB.getTime() - dateA.getTime();
        });

      if (list.length > 0) {
        setMatches(list);
        const first = list[0];
        setSelectedMatchId((prev) => prev || first.id);
        const latestDate =
          typeof first.date === "string"
            ? new Date(first.date)
            : first.date.toDate();
        setLatestMatchDateLabel(latestDate.toLocaleDateString("vi-VN"));
      } else {
        setMatches([]);
        setSelectedMatchId(null);
        setLatestMatchDateLabel("");
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedMatchId && matches.length > 0) {
      setSelectedMatchId(matches[0].id);
      const latestDate =
        typeof matches[0].date === "string"
          ? new Date(matches[0].date)
          : matches[0].date.toDate();
      setLatestMatchDateLabel(latestDate.toLocaleDateString("vi-VN"));
    }
  }, [matches, selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchId) {
      setLiveEvents([]);
      setLiveStatsList([]);
      return;
    }
    setIsLoadingLive(true);
    const eventsQuery = query(
      collection(db, "matches", selectedMatchId, "liveEvents"),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(
      eventsQuery,
      (snapshot) => {
        const events = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() } as LiveEvent)
        );
        setLiveEvents(events);
        setIsLoadingLive(false);
      },
      () => {
        setLiveEvents([]);
        setLiveStatsList([]);
        setIsLoadingLive(false);
      }
    );
    return () => unsubscribe();
  }, [selectedMatchId]);

  useEffect(() => {
    const statsMap = aggregateLiveStats(
      liveEvents.map((ev) => ({ memberId: ev.memberId, type: ev.type })),
      weights
    );
    const statsList = Array.from(statsMap.values())
      .map((stat) => ({
        ...stat,
        name: members.get(stat.memberId) || "Không rõ",
      }))
      .filter((s) => s.total > 0 || s.foul > 0 || s.yellow > 0 || s.red > 0)
      .sort((a, b) => {
        if (b.primaryScore !== a.primaryScore)
          return b.primaryScore - a.primaryScore;
        return b.total - a.total;
      });
    setLiveStatsList(statsList);
  }, [liveEvents, members, weights]);

  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === selectedMatchId),
    [matches, selectedMatchId]
  );

  const memberTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    const teams = selectedMatch?.teamsConfig || [];
    teams.forEach((team) =>
      (team.members || []).forEach((m) => map.set(m.id, team.id))
    );
    return map;
  }, [selectedMatch]);

  const displayTeams = useMemo(() => {
    if (selectedMatch?.teamsConfig?.length) {
      return selectedMatch.teamsConfig.map(
        (t) => [t.id, t.name] as [string, string]
      );
    }
    if (selectedMatch?.teamNames) {
      return Object.entries(selectedMatch.teamNames);
    }
    return [];
  }, [selectedMatch]);

  const teamScore = useMemo(() => {
    const map = new Map<string, number>();
    liveEvents.forEach((ev) => {
      if (ev.type !== "goal") return;
      const teamId = ev.memberId ? memberTeamMap.get(ev.memberId) : undefined;
      const key = teamId || "others";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [liveEvents, memberTeamMap]);

  const scoreLine = useMemo(() => {
    if (displayTeams.length >= 2) {
      const [homeId, homeName] = displayTeams[0];
      const [awayId, awayName] = displayTeams[1];
      return `${homeName} ${teamScore.get(homeId) || 0} - ${
        teamScore.get(awayId) || 0
      } ${awayName}`;
    }
    return null;
  }, [displayTeams, teamScore]);

  useEffect(() => {
    if (!selectedMatchId || members.size === 0) return;

    setIsLoadingDetails(true);
    setAdminRatings(new Map());

    let ratingsLoaded = false;
    let adminLoaded = false;
    const finishLoading = () => {
      if (ratingsLoaded && adminLoaded) {
        setIsLoadingDetails(false);
      }
    };

    // Check if ratings are published for this match
    const checkRatingsPublished = async () => {
      const matchRef = doc(db, "matches", selectedMatchId);
      const matchSnap = await getDoc(matchRef);
      if (matchSnap.exists()) {
        setIsMatchFullyPaid(matchSnap.data().ratingsPublished || false);
      } else {
        setIsMatchFullyPaid(false);
      }
    };

    checkRatingsPublished();

    const ratingsQuery = query(
      collection(db, "matches", selectedMatchId, "ratings")
    );
    const unsubscribeRatings = onSnapshot(
      ratingsQuery,
      (ratingsSnapshot) => {
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
            if (rating.ratedByMemberId === rating.mvpPlayerId) {
              // Bỏ qua tự vote MVP
              return;
            }
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

        const validMvpEntries = Array.from(mvpVotes.entries()).filter(
          ([, data]) => data.count >= MIN_MVP_VOTES
        );

        const sortedMvp = validMvpEntries
          .map(([mvpId, data]) => ({
            mvpId,
            mvpName: members.get(mvpId) || "Không rõ",
            voteCount: data.count,
            votedBy: data.voters,
          }))
          .sort((a, b) => b.voteCount - a.voteCount);

        setPlayerRatings(ratingsByPlayer);
        setMvpData(sortedMvp);
        ratingsLoaded = true;
        finishLoading();
      },
      (err) => {
        console.error("Error loading ratings", err);
        setPlayerRatings(new Map());
        setMvpData([]);
        ratingsLoaded = true;
        finishLoading();
      }
    );

    const adminRatingsQuery = query(
      collection(db, "matches", selectedMatchId, "adminRatings")
    );
    const unsubscribeAdminRatings = onSnapshot(
      adminRatingsQuery,
      (adminSnapshot) => {
        const adminMap = new Map<string, AdminRating>();
        adminSnapshot.forEach((docSnap) => {
          const data = docSnap.data() as AdminRating;
          adminMap.set(docSnap.id, {
            score: typeof data.score === "number" ? data.score : 0,
            notes: data.notes,
          });
        });
        setAdminRatings(adminMap);
        adminLoaded = true;
        finishLoading();
      },
      (err) => {
        console.error("Error loading admin ratings", err);
        setAdminRatings(new Map());
        adminLoaded = true;
        finishLoading();
      }
    );

    return () => {
      unsubscribeRatings();
      unsubscribeAdminRatings();
    };
  }, [selectedMatchId, members]);

  useEffect(() => {
    if (members.size === 0) return;

    const fetchOverallStats = async () => {
      setOverallStats((prev) => ({ ...prev, isLoading: true }));
      setPreviousWeek((prev) => ({ ...prev, isLoading: true }));

      const now = new Date();
      const day = now.getDay(); // 0 (Sun) - 6 (Sat)
      const daysSinceMonday = (day + 6) % 7;
      const startOfThisWeek = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysSinceMonday
      );
      startOfThisWeek.setHours(0, 0, 0, 0);
      const startOfPrevWeek = new Date(startOfThisWeek);
      startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);
      const endOfPrevWeek = new Date(startOfThisWeek.getTime() - 1);
      const prevWeekLabel = `${startOfPrevWeek.toLocaleDateString(
        "vi-VN"
      )} - ${endOfPrevWeek.toLocaleDateString("vi-VN")}`;

      const matchesQuery = query(
        collection(db, "matches"),
        where("status", "==", "PUBLISHED")
      );
      const matchesSnapshot = await getDocs(matchesQuery);

      const allPlayerRatings = new Map<
        string,
        { totalPoints: number; ratingCount: number; adminTotal: number; adminCount: number }
      >();
      const allMvpVotes = new Map<string, number>();
      const weekPlayerRatings = new Map<
        string,
        { totalPoints: number; ratingCount: number; adminTotal: number; adminCount: number }
      >();
      const weekMvpVotes = new Map<string, number>();

      for (const matchDoc of matchesSnapshot.docs) {
        const matchData = matchDoc.data();
        if (matchData.isDeleted) continue;

        const sharesQuery = query(collection(matchDoc.ref, "shares"));
        const sharesSnapshot = await getDocs(sharesQuery);
        const totalShares = sharesSnapshot.size;
        if (totalShares === 0) continue;

        let paidCount = 0;
        sharesSnapshot.forEach((shareDoc) => {
          if (shareDoc.data().status === "PAID") {
            paidCount++;
          }
        });

        if (paidCount !== totalShares) {
          continue;
        }

        const dateObj = matchData.date as Timestamp | string | undefined;
        const matchDate = (dateObj as Timestamp)?.toDate
          ? (dateObj as Timestamp).toDate()
          : new Date(dateObj as string);
        const inPrevWeek =
          matchDate.getTime() >= startOfPrevWeek.getTime() &&
          matchDate.getTime() <= endOfPrevWeek.getTime();

        const ratingsSnapshot = await getDocs(
          query(collection(matchDoc.ref, "ratings"))
        );
        const adminRatingsSnapshot = await getDocs(
          query(collection(matchDoc.ref, "adminRatings"))
        );

        ratingsSnapshot.forEach((ratingDoc) => {
          const rating = ratingDoc.data();

          rating.playerRatings.forEach(
            (playerRating: { memberId: string; score: number }) => {
              const current = allPlayerRatings.get(playerRating.memberId) || {
                totalPoints: 0,
                ratingCount: 0,
                adminTotal: 0,
                adminCount: 0,
              };
              current.totalPoints += playerRating.score;
              current.ratingCount += 1;
              allPlayerRatings.set(playerRating.memberId, current);

              if (inPrevWeek) {
                const weekCurrent = weekPlayerRatings.get(
                  playerRating.memberId
                ) || {
                  totalPoints: 0,
                  ratingCount: 0,
                  adminTotal: 0,
                  adminCount: 0,
                };
                weekCurrent.totalPoints += playerRating.score;
                weekCurrent.ratingCount += 1;
                weekPlayerRatings.set(playerRating.memberId, weekCurrent);
              }
            }
          );

          if (rating.mvpPlayerId) {
            if (rating.ratedByMemberId === rating.mvpPlayerId) {
              return;
            }
            allMvpVotes.set(
              rating.mvpPlayerId,
              (allMvpVotes.get(rating.mvpPlayerId) || 0) + 1
            );

            if (inPrevWeek) {
              weekMvpVotes.set(
                rating.mvpPlayerId,
                (weekMvpVotes.get(rating.mvpPlayerId) || 0) + 1
              );
            }
          }
        });

        adminRatingsSnapshot.forEach((adminDoc) => {
          const data = adminDoc.data();
          const rawScore = data.score;
          const adminScore =
            typeof rawScore === "number"
              ? rawScore
              : Number.parseFloat(rawScore || "0");
          if (!Number.isFinite(adminScore)) return;
          const addAdmin = (map: typeof allPlayerRatings) => {
            const current = map.get(adminDoc.id) || {
              totalPoints: 0,
              ratingCount: 0,
              adminTotal: 0,
              adminCount: 0,
            };
            current.adminTotal += adminScore;
            current.adminCount += 1;
            map.set(adminDoc.id, current);
          };

          addAdmin(allPlayerRatings);
          if (inPrevWeek) {
            addAdmin(weekPlayerRatings);
          }
        });
      }

      const calculateTop = (
        map: Map<
          string,
          {
            totalPoints: number;
            ratingCount: number;
            adminTotal: number;
            adminCount: number;
          }
        >
      ) =>
        Array.from(map.entries())
          .map(([memberId, data]) => {
            const peer =
              data.ratingCount > 0 ? data.totalPoints / data.ratingCount : 0;
            const admin =
              data.adminCount > 0 ? data.adminTotal / data.adminCount : 0;
            return {
              memberId,
              memberName: members.get(memberId) || "Không rõ",
              finalScore: Math.min(peer + admin, 10),
              peerScore: peer,
              adminScore: admin,
            };
          })
          .sort((a, b) => b.finalScore - a.finalScore);

      const calculatedRatings = calculateTop(allPlayerRatings)
        .slice(0, 3);

      const sortedMvp = Array.from(allMvpVotes.entries())
        .map(([memberId, voteCount]) => ({
          memberId,
          memberName: members.get(memberId) || "Không rõ",
          voteCount,
        }))
        .filter((entry) => entry.voteCount >= MIN_MVP_VOTES)
        .sort((a, b) => b.voteCount - a.voteCount)
        .slice(0, 3);

      const topWeekRatingEntry = calculateTop(weekPlayerRatings)[0];

      const topWeekMvp = Array.from(weekMvpVotes.entries())
        .map(([memberId, voteCount]) => ({
          memberId,
          memberName: members.get(memberId) || "Không rõ",
          voteCount,
        }))
        .filter((entry) => entry.voteCount >= MIN_MVP_VOTES)
        .sort((a, b) => b.voteCount - a.voteCount)[0];

      setOverallStats({
        topRatings: calculatedRatings,
        topMvp: sortedMvp,
        isLoading: false,
      });
      setPreviousWeek({
        topRating: topWeekRatingEntry || null,
        topMvp: topWeekMvp || null,
        rangeLabel: prevWeekLabel,
        isLoading: false,
      });
    };

    fetchOverallStats();
  }, [members]);

  const sortedFinalRatings = useMemo(() => {
    return Array.from(combinedRatings.entries()).sort(
      ([, a], [, b]) => b.finalScore - a.finalScore
    );
  }, [combinedRatings]);

  const statCategories = useMemo(
    () => [
      { key: "goal", icon: "🥅" },
      { key: "assist", icon: "🎯" },
      { key: "save_gk", icon: "🧤" },
      { key: "tackle", icon: "🛡️" },
      { key: "dribble", icon: "🌀" },
      { key: "foul", icon: "⚠️" },
      { key: "yellow", icon: "🟨" },
      { key: "red", icon: "🟥" },
      ...(weights.extras || []).map((ex) => ({
        key: ex.key,
        icon: ex.isNegative ? "⚡" : "✨",
      })),
    ],
    [weights.extras]
  );

  return (
    <div className="min-h-screen animated-gradient p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Bảng xếp hạng & Ấn tượng
          </h1>
          <p className="text-muted-foreground mt-2">
            Trận gần nhất: {latestMatchDateLabel || "Chưa có dữ liệu"}
          </p>
        </div>

        <div className="mb-8 grid gap-6 md:grid-cols-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-500" /> Top 3 MVP (điểm
                cao)
              </CardTitle>
              <CardDescription>
                Tính trên tất cả các trận đã đấu
              </CardDescription>
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
                        className={cn(
                          "font-semibold",
                          index === 0 && "text-lg"
                        )}
                      >
                        {index + 1}. {player.memberName}
                      </span>
                      <div className="text-right">
                        <Badge
                          variant={index === 0 ? "default" : "secondary"}
                          className="mb-1"
                        >
                          {player.finalScore.toFixed(2)} điểm /10
                        </Badge>
                        <div className="text-[11px] text-muted-foreground">
                          Peer: {player.peerScore.toFixed(2)} /5 • Admin:{" "}
                          {player.adminScore > 0
                            ? `${player.adminScore.toFixed(2)} /5`
                            : "Chưa chấm"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" /> Top 3 Ấn tượng
                (vote)
              </CardTitle>
              <CardDescription>
                Tính trên tất cả các trận đã đấu
              </CardDescription>
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
                        className={cn(
                          "font-semibold",
                          index === 0 && "text-lg"
                        )}
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
                        setAdminRatings(new Map());
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
                <div className="space-y-4">
                  <Card className="shadow-card">
                    <CardHeader>
                      <CardTitle>Live notes & Thống kê nhanh</CardTitle>
                      <CardDescription>
                        Tổng hợp sự kiện của trận đấu (chỉ xem).
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {displayTeams.length >= 2 && (
                        <div className="grid grid-cols-2 gap-2">
                          {displayTeams
                            .slice(0, 2)
                            .map(([teamId, teamName]) => (
                              <Card key={teamId} className="p-3 border-dashed">
                                <div className="text-base font-semibold truncate">
                                  {teamName}
                                </div>
                                <div className="text-3xl font-black">
                                  {teamScore.get(teamId) || 0}
                                </div>
                              </Card>
                            ))}
                        </div>
                      )}
                      {isLoadingLive ? (
                        <div className="text-center">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                          <p className="text-sm text-muted-foreground mt-2">
                            Đang tải live notes...
                          </p>
                        </div>
                      ) : liveEvents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Chưa có live notes cho trận đấu này.
                        </p>
                      ) : (
                        <>
                          <div className="grid gap-3 md:grid-cols-2">
                            {statCategories.map((item) => {
                              const top = topByField(
                                liveStatsList,
                                item.key as keyof AggregatedStat
                              );
                              const displayList = expandedStats.has(item.key)
                                ? top
                                : top.slice(0, 3);
                              const remainingCount = Math.max(
                                0,
                                top.length - displayList.length
                              );
                              return (
                                <div
                                  key={item.key}
                                  className="border rounded-md p-3"
                                >
                                  <div className="font-semibold mb-2 flex items-center gap-2">
                                    <span>{item.icon}</span>
                                    <span>
                                      {labelFor(item.key) || item.key}
                                    </span>
                                  </div>
                                  {top.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                      Chưa có dữ liệu.
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      <div className="space-y-1 text-sm">
                                        {displayList.map((stat, idx) => {
                                          const value = stat[
                                            item.key as keyof AggregatedStat
                                          ] as number;
                                          return (
                                            <div
                                              key={stat.memberId + idx}
                                              className="flex justify-between items-center"
                                            >
                                              <span>{stat.name}</span>
                                              <Badge
                                                variant="secondary"
                                                className={cn(
                                                  "cursor-default",
                                                  badgeClassFor(item.key)
                                                )}
                                              >
                                                {labelFor(item.key)} {value}
                                              </Badge>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {remainingCount > 0 && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="w-full h-7 text-xs"
                                          onClick={() => {
                                            setExpandedStats((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(item.key)) {
                                                next.delete(item.key);
                                              } else {
                                                next.add(item.key);
                                              }
                                              return next;
                                            });
                                          }}
                                        >
                                          {expandedStats.has(item.key)
                                            ? "Thu gọn"
                                            : `Xem thêm (${remainingCount})`}
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <div className="space-y-2">
                            <h4 className="font-semibold">Sự kiện</h4>
                            <div className="space-y-1 max-h-72 overflow-y-auto text-sm">
                              {liveEvents.slice(0, 20).map((ev) => {
                                const name =
                                  members.get(ev.memberId || "") || "Không rõ";
                                return (
                                  <div
                                    key={ev.id}
                                    className="flex items-center justify-between rounded border p-2"
                                  >
                                    <div className="space-y-1">
                                      <div className="font-semibold">
                                        {labelFor(ev.type)}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {name}
                                      </div>
                                    </div>
                                    <Badge variant="secondary">
                                      {ev.minute !== undefined &&
                                      ev.minute !== null
                                        ? `${ev.minute}'`
                                        : "--"}{" "}
                                      {ev.second !== undefined &&
                                      ev.second !== null
                                        ? `${String(ev.second).padStart(
                                            2,
                                            "0"
                                          )}"`
                                        : ""}
                                    </Badge>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="shadow-card">
                    {!isMatchFullyPaid ? (
                      <CardContent className="p-12 text-center flex flex-col items-center justify-center h-full">
                        <Info className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                        <h3 className="mt-4 text-lg font-semibold">
                          Chưa công khai đánh giá
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Đánh giá sẽ được công khai sau khi trận đấu hoàn thành
                          thanh toán.
                        </p>
                      </CardContent>
                    ) : mvpData.length === 0 && combinedRatings.size === 0 ? (
                      <CardContent className="p-12 text-center flex flex-col items-center justify-center h-full">
                        <Info className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                        <h3 className="mt-4 text-lg font-semibold">
                          Chưa có dữ liệu đánh giá
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Trận đấu này chưa có thông tin về vote hoặc điểm số.
                        </p>
                      </CardContent>
                    ) : (
                      <CardContent className="p-4 space-y-4">
                        {topScoreEntry && (
                          <div className="rounded-md border p-3 bg-muted/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-blue-500" />
                                <div className="space-y-1">
                                  <div className="font-semibold">
                                    MVP (top tổng điểm)
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {topScoreEntry.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Peer: {topScoreEntry.peer.toFixed(2)} /5 ·
                                    Admin:{" "}
                                    {topScoreEntry.hasAdmin
                                      ? `${topScoreEntry.admin.toFixed(2)} /5`
                                      : "Chưa chấm"}
                                  </div>
                                </div>
                              </div>
                              <Badge variant="secondary">
                                {topScoreEntry.final.toFixed(2)} / 10
                              </Badge>
                            </div>
                          </div>
                        )}
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
                                    Cầu thủ ấn tượng (vote)
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
                                            index === 0
                                              ? "default"
                                              : "secondary"
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
                        {mvpData.length === 0 && (
                          <div className="p-3 text-sm text-muted-foreground">
                            Vote sẽ hiển thị khi đủ phiếu hợp lệ (không tính tự
                            vote).
                          </div>
                        )}

                        {combinedRatings.size > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-5 h-5 text-blue-500" />
                              <h4 className="font-semibold">
                                Bảng điểm trận đấu (final)
                              </h4>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Hạng</TableHead>
                                  <TableHead>Cầu thủ</TableHead>
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
                                {sortedFinalRatings.map(
                                  ([memberId, ratingData], index) => {
                                    const peerScore = ratingData.averageScore;
                                    const adminScore = ratingData.adminScore;
                                    const finalScore = ratingData.finalScore;
                                    const hasAdminScore = ratingData.hasAdminScore;
                                    return (
                                      <Dialog key={memberId}>
                                        <DialogTrigger asChild>
                                          <TableRow className="cursor-pointer">
                                            <TableCell className="font-medium">
                                              {index + 1}
                                            </TableCell>
                                            <TableCell>
                                              {members.get(memberId) ||
                                                "Không rõ"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                              {ratingData.ratingCount > 0 ? (
                                                <Badge variant="outline">
                                                  {peerScore.toFixed(2)}
                                                </Badge>
                                              ) : (
                                                <span className="text-xs text-muted-foreground">
                                                  Chưa có
                                                </span>
                                              )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                              {hasAdminScore ? (
                                                <Badge variant="secondary">
                                                  {adminScore.toFixed(2)}
                                                </Badge>
                                              ) : (
                                                <span className="text-xs text-muted-foreground">
                                                  Chưa chấm
                                                </span>
                                              )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                              <Badge>
                                                {finalScore.toFixed(2)}
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
                                          <div className="space-y-3 text-sm">
                                            <div className="flex items-center justify-between">
                                              <span>Điểm cuối</span>
                                              <Badge>
                                                {finalScore.toFixed(2)} / 10
                                              </Badge>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span>Peer</span>
                                              <Badge variant="outline">
                                                {peerScore.toFixed(2)} / 5
                                              </Badge>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span>Admin</span>
                                              {hasAdminScore ? (
                                                <Badge variant="secondary">
                                                  {adminScore.toFixed(2)} / 5
                                                </Badge>
                                              ) : (
                                                <span className="text-xs text-muted-foreground">
                                                  Chưa chấm
                                                </span>
                                              )}
                                            </div>
                                            <div className="pt-2 border-t">
                                              <div className="font-medium mb-2">
                                                Chi tiết điểm từ thành viên khác
                                              </div>
                                              {ratingData.details.length ===
                                              0 ? (
                                                <p className="text-xs text-muted-foreground">
                                                  Chưa có đánh giá từ thành viên
                                                  khác.
                                                </p>
                                              ) : (
                                                <ul className="space-y-2 max-h-60 overflow-y-auto">
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
                                              )}
                                            </div>
                                          </div>
                                        </DialogContent>
                                      </Dialog>
                                    );
                                  }
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicRatings;
