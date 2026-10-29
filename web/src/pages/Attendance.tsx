import { hasFeature } from "@/lib/features";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { useState, useEffect, useCallback, useMemo, useRef, DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Check,
  Loader2,
  Search,
  Users,
  Calendar as CalendarIcon,
  ArrowLeft,
  Pin,
  PinOff,
  History,
  RotateCcw,
  Repeat,
  X,
  MapPin,
  Bell,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";
import {
  collection,
  getDocs,
  doc,
  Timestamp,
  query,
  orderBy,
  where,
  onSnapshot,
} from "firebase/firestore";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import useLocalStorage from "@/hooks/useLocalStorage";
import { ensureNotificationToken } from "@/lib/notifications";
import { postApiJson } from "@/lib/api";
import { MATCH_TZ, getMatchTimeParts, formatMatchDateTime, cn } from "@/lib/utils";
import {
  EloTier,
  TIER_CONFIG,
  getEloTier,
  balanceTeamsByElo,
} from "@/lib/elo";

// Interfaces
interface Member {
  id: string;
  name: string;
  nickname?: string;
  autoAttendance?: boolean;
  inactive?: boolean;
  isPriority?: boolean;
  elo?: number;
  eloTier?: EloTier;
  eloRank?: number;
}

interface Match {
  id: string;
  date: Timestamp;
  totalAmount: number;
  isDeleted?: boolean;
  teamCount?: number;
  venueName?: string;
  mapIframe?: string;
  attendanceCloseHours?: number;
  attendanceReminderOnly?: boolean;
  teamsConfig?: {
    id: string;
    name: string;
    members?: { id: string }[];
    memberIds?: string[];
  }[];
}

interface AttendanceRecord {
  timestamp: Timestamp;
  memberName: string;
  userAgent: string;
}

type ActionType = "ATTEND" | "NOT_ATTEND" | "CANCEL_ATTEND" | "CANCEL_NOT_ATTEND";

interface AttendanceLogEntry {
  type: ActionType;
  memberId: string;
  memberName: string;
  timestamp: Timestamp;
  userAgent?: string;
  deviceId?: string;
  deviceModel?: string;
  clientIp?: string;
  actorMemberId?: string;
  actorName?: string;
  isProxyAction?: boolean;
}

interface Team {
  id: string;
  name: string;
  members: Member[];
}

function getOrCreateDeviceId(): string {
  try {
    if (typeof localStorage === "undefined") return "dev_node";
    const key = "fb_device_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = "dev_" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "dev_fallback";
  }
}

function getAssociatedMemberId(groupId: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(`fb_actor_${groupId}`) || null;
  } catch {
    return null;
  }
}

function setAssociatedMemberId(groupId: string, memberId: string) {
  try {
    if (typeof localStorage === "undefined") return;
    const key = `fb_actor_${groupId}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, memberId);
    }
  } catch {}
}

const Attendance = () => {
  const { groupId, group } = useGroup();
  const groupPath = useGroupPath();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [pendingMatches, setPendingMatches] = useState<Match[]>([]);
  const selectedMatchRef = useRef<string | null>(null);
  const fetchVersion = useRef(0);
  const [match, setMatch] = useState<Match | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [attendance, setAttendance] = useState<Map<string, AttendanceRecord>>(
    new Map()
  );
  const [notAttendance, setNotAttendance] = useState<
    Map<string, AttendanceRecord>
  >(new Map());
  const [isSubmitting, setIsSubmitting] = useState<Set<string>>(new Set());
  const [attendanceHistory, setAttendanceHistory] = useState<
    AttendanceLogEntry[]
  >([]);
  const [pinnedMembers, setPinnedMembers] = useLocalStorage<string[]>(
    "pinnedMembers",
    []
  );
  const [mapExpanded, setMapExpanded] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [isRegisteringNotif, setIsRegisteringNotif] = useState(false);
  const [teamPool, setTeamPool] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [teamBuilderInitialized, setTeamBuilderInitialized] = useState(false);

  const membersMap = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  );

  // Tick every minute so the countdown + closed status stay live without a refresh.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { closingTime, isAttendanceClosed, isReminderOnly, timeUntilClose } = useMemo(() => {
    if (!match) {
      return {
        closingTime: null,
        isAttendanceClosed: false,
        isReminderOnly: false,
        timeUntilClose: null,
      };
    }

    const isReminderOnly = Boolean(match.attendanceReminderOnly);
    const closeHours = match.attendanceCloseHours ?? 12;
    const matchDate = new Date(match.date.seconds * 1000);

    const closingDate = new Date(
      matchDate.getTime() - closeHours * 60 * 60 * 1000
    );

    const isClosed = !isReminderOnly && now > closingDate;
    let timeUntilClose: {
      label: string;
      tone: "safe" | "warning" | "danger";
    } | null = null;

    if (now <= closingDate) {
      const diffMs = closingDate.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      const totalHours = Math.floor(diffHours);
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      let label = "";
      if (days >= 1) {
        label = hours > 0 ? `${days} ngày ${hours}h` : `${days} ngày`;
      } else if (totalHours >= 1) {
        label = `${totalHours}h ${minutes}'`;
      } else {
        label = `${minutes}'`;
      }

      let tone: "safe" | "warning" | "danger" = "safe";
      if (diffHours < 12) tone = "danger";
      else if (diffHours < 24) tone = "warning";

      timeUntilClose = { label, tone };
    }

    return {
      closingTime: closingDate,
      isAttendanceClosed: isClosed,
      isReminderOnly,
      timeUntilClose,
    };
  }, [match, now]);

  useEffect(() => {
    if (!matchId) {
      setAttendanceHistory([]); // Clear history if no match
      return;
    }

    const logQuery = query(
      collection(db, "matches", matchId, "attendanceLog"),
      orderBy("timestamp", "desc")
    );

    const version = fetchVersion.current;
    const unsubscribe = onSnapshot(logQuery, (snapshot) => {
      if (version !== fetchVersion.current) return;
      const history = snapshot.docs.map(
        (doc) => doc.data() as AttendanceLogEntry
      );
      setAttendanceHistory(history);
    });

    // Cleanup listener on component unmount or when matchId changes
    return () => unsubscribe();
  }, [matchId]);

  const fetchMatchAndMembers = useCallback(async (requestedMatchId?: string) => {
    const version = ++fetchVersion.current;
    if (requestedMatchId) selectedMatchRef.current = requestedMatchId;
    setIsLoading(true);
    setMatchId(null);
    setAttendance(new Map());
    setNotAttendance(new Map());
    setAttendanceHistory([]);
    setTeams([]);
    setTeamPool([]);
    setTeamBuilderInitialized(false);
    setTeamSearch("");
    setMapExpanded(false);
    try {
      const matchesQuery = query(
        collection(db, "matches"),
        where("groupId", "==", groupId),
        where("status", "==", "PENDING"),
        orderBy("createdAt", "desc")
      );
      const matchSnapshot = await getDocs(matchesQuery);
      if (version !== fetchVersion.current) return;
      const availableMatches = matchSnapshot.docs
        .filter((snapshot) => !snapshot.data().isDeleted)
        .map((snapshot) => ({ ...snapshot.data(), id: snapshot.id } as Match));
      setPendingMatches(availableMatches);
      const selectedMatch = availableMatches.find((item) => item.id === selectedMatchRef.current)
        || availableMatches[0];
      if (!selectedMatch) {
        setMatch(null);
        selectedMatchRef.current = null;
        return;
      }

      const [membersSnapshot, attendanceSnapshot, notAttendanceSnapshot] = await Promise.all([
        getDocs(query(collection(db, "members"), where("groupId", "==", groupId), orderBy("name", "asc"))),
        getDocs(collection(db, "matches", selectedMatch.id, "attendance")),
        getDocs(collection(db, "matches", selectedMatch.id, "not_attending")),
      ]);
      if (version !== fetchVersion.current) return;
      setMembers(membersSnapshot.docs
        .map((snapshot) => ({ ...snapshot.data(), id: snapshot.id } as Member))
        .filter((member) => !member.inactive));
      setAttendance(new Map(attendanceSnapshot.docs.map((snapshot) =>
        [snapshot.id, snapshot.data() as AttendanceRecord])));
      setNotAttendance(new Map(notAttendanceSnapshot.docs.map((snapshot) =>
        [snapshot.id, snapshot.data() as AttendanceRecord])));
      selectedMatchRef.current = selectedMatch.id;
      setMatch(selectedMatch);
      setMatchId(selectedMatch.id);
    } catch (error) {
      if (version !== fetchVersion.current) return;
      setMatch(null);
      console.error("Error fetching data: ", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not load match data. Please try again.",
      });
    } finally {
      if (version === fetchVersion.current) setIsLoading(false);
    }
  }, [toast, groupId]);

  useEffect(() => {
    const requests = fetchVersion;
    void fetchMatchAndMembers();
    return () => { requests.current++; };
  }, [fetchMatchAndMembers]);

  const removeDiacritics = (str: string) => {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  };

  const attendanceMembers = useMemo(() => {
    return Array.from(attendance.entries()).map(([memberId, record]) => {
      const knownMember = membersMap.get(memberId);
      return (
        knownMember || {
          id: memberId,
          name: record?.memberName || "Ẩn danh",
        }
      );
    });
  }, [attendance, membersMap]);

  const filteredMembers = useMemo(() => {
    const lowerCaseSearch = removeDiacritics(search.toLowerCase());
    const filtered = members.filter(
      (m) =>
        removeDiacritics(m.name.toLowerCase()).includes(lowerCaseSearch) ||
        (m.nickname &&
          removeDiacritics(m.nickname.toLowerCase()).includes(lowerCaseSearch))
    );

    // Sort: pinned first, then priority, then the rest. Match the ordering on Members page.
    return filtered.sort((a, b) => {
      const isAPinned = pinnedMembers.includes(a.id);
      const isBPinned = pinnedMembers.includes(b.id);
      if (isAPinned && !isBPinned) return -1;
      if (!isAPinned && isBPinned) return 1;

      const isAPriority = !!a.isPriority;
      const isBPriority = !!b.isPriority;
      if (isAPriority && !isBPriority) return -1;
      if (!isAPriority && isBPriority) return 1;

      return 0;
    });
  }, [members, search, pinnedMembers]);

  const handlePinToggle = (memberId: string) => {
    setPinnedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const handleRegisterNotification = async () => {
    setIsRegisteringNotif(true);
    try {
      const token = await ensureNotificationToken(null, groupId);
      if (token) {
        setNotifPermission("granted");
        toast({
          title: "Đã bật thông báo!",
          description: "Bạn sẽ nhận được thông báo về các trận đấu.",
        });
      } else {
        setNotifPermission(
          typeof Notification !== "undefined" ? Notification.permission : "denied"
        );
        toast({
          variant: "destructive",
          title: "Không thể bật thông báo",
          description: "Vui lòng cho phép thông báo trong cài đặt trình duyệt.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể đăng ký thông báo.",
      });
    } finally {
      setIsRegisteringNotif(false);
    }
  };

  const handleUpdateStatus = async (
    memberId: string,
    memberName: string,
    status: "attending" | "not_attending"
  ) => {
    if (!matchId || isLoading) return;

    // Idempotent guard: if already in the requested state, skip.
    if (status === "attending" && attendance.has(memberId)) return;
    if (status === "not_attending" && notAttendance.has(memberId)) return;

    setIsSubmitting((prev) => new Set(prev).add(memberId));
    try {
      const deviceId = getOrCreateDeviceId();
      const screen = typeof window !== "undefined" && window.screen ? `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}` : "";
      const platform = typeof navigator !== "undefined" ? (navigator.platform || "") : "";
      const actorMemberId = getAssociatedMemberId(groupId);
      setAssociatedMemberId(groupId, memberId);

      await postApiJson(`/public/${groupId}/attendance`, {
        matchId,
        memberId,
        action: status,
        deviceId,
        screen,
        platform,
        actorMemberId,
      });

      // Optimistic UI update
      if (status === "attending") {
        setAttendance((prev) => {
          const newMap = new Map(prev);
          newMap.set(memberId, {
            timestamp: Timestamp.now(),
            memberName,
            userAgent: navigator.userAgent,
          });
          return newMap;
        });
        setNotAttendance((prev) => {
          const newMap = new Map(prev);
          newMap.delete(memberId);
          return newMap;
        });
        toast({
          title: "Điểm danh thành công!",
          description: `Cảm ơn ${memberName} đã xác nhận tham gia.`,
        });
      } else {
        setNotAttendance((prev) => {
          const newMap = new Map(prev);
          newMap.set(memberId, {
            timestamp: Timestamp.now(),
            memberName,
            userAgent: navigator.userAgent,
          });
          return newMap;
        });
        setAttendance((prev) => {
          const newMap = new Map(prev);
          newMap.delete(memberId);
          return newMap;
        });
        toast({
          title: "Đã xác nhận không tham gia",
          description: `Đã ghi nhận ${memberName} vắng mặt.`,
        });
      }
    } catch (error) {
      console.error("Error updating status:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái. Vui lòng thử lại.",
      });
    } finally {
      setIsSubmitting((prev) => {
        const newSubmitting = new Set(prev);
        newSubmitting.delete(memberId);
        return newSubmitting;
      });
    }
  };

  const initializeTeamsFromMatch = useCallback(() => {
    if (!match) return;

    const baseTeamCount = match.teamCount || match.teamsConfig?.length || 2;
    const fallbackIds = ["A", "B", "C"];
    const teamIds = fallbackIds.slice(0, baseTeamCount);

    const configTeams = match.teamsConfig || [];
    const builtTeams = teamIds.map((teamId, index) => {
      const configTeam =
        configTeams.find((team) => team.id === teamId) || configTeams[index];
      const memberIds =
        configTeam?.members?.map((m) => m.id) || configTeam?.memberIds || [];
      const memberList = memberIds
        .map((memberId) => {
          const memberFromList = membersMap.get(memberId);
          if (memberFromList) return memberFromList;
          const attendanceRecord = attendance.get(memberId);
          if (attendanceRecord) {
            return { id: memberId, name: attendanceRecord.memberName };
          }
          return null;
        })
        .filter((m): m is Member => Boolean(m))
        .filter((m) => attendance.has(m.id));

      return {
        id: configTeam?.id || teamId,
        name: configTeam?.name || `Đội ${teamId}`,
        members: memberList,
      };
    });

    const assignedIds = new Set(
      builtTeams.flatMap((team) => team.members.map((member) => member.id))
    );
    const poolMembers = attendanceMembers.filter(
      (member) => !assignedIds.has(member.id)
    );

    setTeams(builtTeams);
    setTeamPool(poolMembers);
    setTeamBuilderInitialized(true);
  }, [attendance, attendanceMembers, match, membersMap]);

  useEffect(() => {
    if (!hasFeature(groupId, group, "teamPropose") || !match || teamBuilderInitialized || isLoading) return;
    initializeTeamsFromMatch();
  }, [initializeTeamsFromMatch, isLoading, match, teamBuilderInitialized, groupId, group]);

  useEffect(() => {
    if (!teamBuilderInitialized) return;

    const assignedIds = new Set(
      teams.flatMap((team) => team.members.map((member) => member.id))
    );

    setTeamPool((prevPool) => {
      const existingPool = prevPool.filter((member) =>
        attendance.has(member.id)
      );
      const poolIds = new Set(existingPool.map((member) => member.id));
      const newAttendees = attendanceMembers.filter(
        (member) => !assignedIds.has(member.id) && !poolIds.has(member.id)
      );
      if (
        newAttendees.length === 0 &&
        existingPool.length === prevPool.length
      ) {
        return prevPool;
      }
      return [...existingPool, ...newAttendees];
    });
  }, [attendance, attendanceMembers, teamBuilderInitialized, teams]);

  const handleTeamDragStart = (
    e: DragEvent,
    member: Member,
    source: string
  ) => {
    e.dataTransfer.setData("member", JSON.stringify(member));
    e.dataTransfer.setData("source", source);
  };

  const handleTeamDrop = (e: DragEvent, targetTeamId: string | "pool") => {
    e.preventDefault();
    const memberData = e.dataTransfer.getData("member");
    if (!memberData) return;

    const member: Member = JSON.parse(memberData);
    const source = e.dataTransfer.getData("source");

    setTeams((prevTeams) => {
      let updatedTeams = prevTeams.map((team) =>
        team.id === source
          ? {
              ...team,
              members: team.members.filter((m) => m.id !== member.id),
            }
          : team
      );

      if (targetTeamId !== "pool") {
        updatedTeams = updatedTeams.map((team) =>
          team.id === targetTeamId
            ? team.members.some((m) => m.id === member.id)
              ? team
              : { ...team, members: [...team.members, member] }
            : team
        );
      }

      return updatedTeams;
    });

    setTeamPool((prevPool) => {
      const filteredPool = prevPool.filter((m) => m.id !== member.id);
      if (targetTeamId === "pool" && attendance.has(member.id)) {
        return filteredPool.some((m) => m.id === member.id)
          ? filteredPool
          : [...filteredPool, member];
      }
      return filteredPool;
    });
  };

  const handleResetTeams = () => {
    setTeams((prevTeams) =>
      prevTeams.map((team) => ({ ...team, members: [] }))
    );
    setTeamPool(attendanceMembers);
  };

  const handleAutoBalanceElo = () => {
    if (teams.length === 0) {
      toast({
        variant: "destructive",
        title: "Chưa có đội",
        description: "Trận đấu chưa có cấu hình đội để phân chia.",
      });
      return;
    }

    // Collect all attending members currently in either pool or teams
    const allPlayersMap = new Map<string, Member>();
    teamPool.forEach((m) => allPlayersMap.set(m.id, m));
    teams.forEach((t) => t.members.forEach((m) => allPlayersMap.set(m.id, m)));
    attendanceMembers.forEach((m) => allPlayersMap.set(m.id, m));

    const playersToBalance = Array.from(allPlayersMap.values());
    if (playersToBalance.length === 0) {
      toast({
        variant: "destructive",
        title: "Chưa có ai điểm danh",
        description: "Cần ít nhất 1 thành viên điểm danh để chia đội.",
      });
      return;
    }

    const { teams: balancedTeamLists, deltaElo } = balanceTeamsByElo(
      playersToBalance,
      teams.length
    );

    const updatedTeams = teams.map((team, idx) => ({
      ...team,
      members: balancedTeamLists[idx] || [],
    }));

    setTeams(updatedTeams);
    setTeamPool([]);

    toast({
      title: "⚡ Đã chia đều theo ELO",
      description: `Đã phân chia ${playersToBalance.length} người vào ${teams.length} đội (Độ chênh lệch: ${deltaElo} ELO).`,
    });
  };

  const [isSendingTeams, setIsSendingTeams] = useState(false);
  const [isPasscodeDialogOpen, setIsPasscodeDialogOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);

  // Validate teams before opening passcode dialog.
  const handleSendTeamsClick = () => {
    if (!matchId) return;
    const teamsWithMembers = teams.filter((t) => t.members.length > 0);
    if (teamsWithMembers.length === 0) {
      toast({
        variant: "destructive",
        title: "Chưa có đội nào",
        description: "Vui lòng kéo người vào ít nhất 1 đội trước khi gửi.",
      });
      return;
    }
    if (teamPool.length > 0) {
      const proceed = window.confirm(
        `Còn ${teamPool.length} người chưa được chia đội. Bạn vẫn muốn gửi đề xuất?`
      );
      if (!proceed) return;
    }
    setPasscode("");
    setShowPasscode(false);
    setIsPasscodeDialogOpen(true);
  };

  const handleSendTeamsToSlack = async () => {
    if (!matchId || !passcode.trim()) return;
    const teamsWithMembers = teams.filter((t) => t.members.length > 0);

    setIsSendingTeams(true);
    try {
      await postApiJson("/teams/propose", {
        matchId,
        passcode: passcode.trim(),
        teamsConfig: teamsWithMembers.map((t) => ({
          id: t.id,
          name: t.name,
          members: t.members.map((m) => ({ id: m.id, name: m.name })),
        })),
      });
      setIsPasscodeDialogOpen(false);
      setPasscode("");
      toast({
        title: "Đã gửi đề xuất!",
        description:
          "Đội hình đã được gửi lên Slack. Bấm nút trong Slack để chốt.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description:
          err instanceof Error
            ? err.message
            : "Không thể gửi đội hình lên Slack.",
      });
    } finally {
      setIsSendingTeams(false);
    }
  };

  const filteredTeamPool = useMemo(() => {
    const lowerCaseSearch = removeDiacritics(teamSearch.toLowerCase());
    return teamPool.filter(
      (member) =>
        removeDiacritics(member.name.toLowerCase()).includes(lowerCaseSearch) ||
        (member.nickname &&
          removeDiacritics(member.nickname.toLowerCase()).includes(
            lowerCaseSearch
          ))
    );
  }, [teamPool, teamSearch]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background text-center px-4">
        <h1 className="text-3xl font-bold text-foreground mb-4">
          Chưa có trận đấu nào để điểm danh
        </h1>
        <p className="text-muted-foreground mb-8">
          Vui lòng chờ quản trị viên tạo trận đấu mới.
        </p>
        <Button onClick={() => navigate(groupPath("public"))}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Quay lại
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {pendingMatches.length > 1 && (
          <div className="mb-6 space-y-2">
            <label htmlFor="attendance-match" className="text-sm font-medium">Choose a match</label>
            <select
              id="attendance-match"
              value={matchId || ""}
              disabled={isLoading || isSubmitting.size > 0 || isSendingTeams || isPasscodeDialogOpen}
              onChange={(event) => void fetchMatchAndMembers(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              {pendingMatches.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatMatchDateTime(item.date)}{item.venueName ? ` · ${item.venueName}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mb-8">
          {(() => {
            const matchDate = new Date(match.date.seconds * 1000);
            const weekdayLabel = matchDate
              .toLocaleDateString("vi-VN", { weekday: "long", timeZone: MATCH_TZ })
              .replace(/^./, (c) => c.toUpperCase());
            const dayMonthYear = matchDate.toLocaleDateString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              timeZone: MATCH_TZ,
            });
            const { hour: matchHour, minute: matchMinute } =
              getMatchTimeParts(matchDate);
            const hasTime = !(matchHour === 0 && matchMinute === 0);
            const timeLabel = hasTime
              ? matchDate.toLocaleTimeString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: MATCH_TZ,
                })
              : null;

            const countdownTone = timeUntilClose?.tone ?? "safe";
            const countdownToneClass = {
              safe: "bg-emerald-50 border-emerald-200 text-emerald-700",
              warning: "bg-amber-50 border-amber-200 text-amber-700",
              danger: "bg-red-50 border-red-200 text-red-700",
            }[countdownTone];

            return (
              <Card
                className={`overflow-hidden shadow-card border-l-4 ${
                  isAttendanceClosed
                    ? "border-l-red-500"
                    : "border-l-emerald-500"
                }`}
              >
                <CardContent className="p-0">
                  {/* Vùng 1: Status pill + title nhỏ */}
                  <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-wider">
                        Điểm danh ra sân
                      </span>
                    </div>
                    {isAttendanceClosed ? (
                      <Badge
                        variant="destructive"
                        className="gap-1 px-2.5 py-1"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        Đã đóng cổng
                      </Badge>
                    ) : (
                      <Badge className="gap-1 px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white">
                        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                        Đang mở
                      </Badge>
                    )}
                  </div>

                  {/* Vùng 2: Date hero */}
                  <div className="px-5 pb-4 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                      {weekdayLabel}
                    </p>
                    <p className="mt-1 text-4xl font-black tracking-tight text-foreground tabular-nums sm:text-5xl">
                      {dayMonthYear}
                    </p>
                    {timeLabel && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        {timeLabel}
                      </div>
                    )}
                  </div>

                  {/* Vùng venue */}
                  {(match.venueName || match.mapIframe) && (
                    <div className="border-t border-border/60 bg-muted/30 px-5 py-3">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <MapPin className="h-4 w-4 text-primary" />
                        {match.venueName && (
                          <span className="font-semibold text-foreground">
                            {match.venueName}
                          </span>
                        )}
                        {match.mapIframe && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setMapExpanded((v) => !v)}
                          >
                            {mapExpanded ? (
                              <ChevronUp className="h-3 w-3 mr-1" />
                            ) : (
                              <ChevronDown className="h-3 w-3 mr-1" />
                            )}
                            {mapExpanded ? "Ẩn bản đồ" : "Xem bản đồ"}
                          </Button>
                        )}
                      </div>
                      {mapExpanded && match.mapIframe && (
                        <div
                          className="mx-auto mt-3 w-full max-w-lg rounded-lg overflow-hidden border shadow-sm [&_iframe]:w-full [&_iframe]:h-64"
                          dangerouslySetInnerHTML={{
                            __html: match.mapIframe.trim().startsWith("<iframe")
                              ? match.mapIframe
                              : "",
                          }}
                        />
                      )}
                    </div>
                  )}

                  {/* Vùng 3: Stats grid */}
                  <div className="grid grid-cols-3 divide-x border-t border-border/60">
                    <div className="flex flex-col items-center justify-center px-3 py-4">
                      <span className="text-3xl font-black tabular-nums text-emerald-600">
                        {attendance.size}
                      </span>
                      <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Tham gia
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center px-3 py-4">
                      <span
                        className={`text-3xl font-black tabular-nums ${
                          notAttendance.size > 0
                            ? "text-red-500"
                            : "text-muted-foreground/40"
                        }`}
                      >
                        {notAttendance.size}
                      </span>
                      <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Vắng
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center px-3 py-4">
                      {isAttendanceClosed ? (
                        <>
                          <span className="text-xl font-black text-red-500">
                            ✕
                          </span>
                          <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            Đã đóng
                          </span>
                        </>
                      ) : (
                        <>
                          <span
                            className={`text-2xl font-black tabular-nums ${
                              countdownTone === "danger"
                                ? "text-red-600"
                                : countdownTone === "warning"
                                ? "text-amber-600"
                                : "text-emerald-600"
                            }`}
                          >
                            {timeUntilClose?.label ?? (isReminderOnly ? "Mở" : "--")}
                          </span>
                          <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            {isReminderOnly ? (timeUntilClose ? "Nhắc chốt" : "Điểm danh") : "Còn lại"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Closing time hint / closed warning */}
                  {isAttendanceClosed ? (
                    <div className={`border-t px-5 py-3 text-center text-sm ${countdownToneClass}`}>
                      <p className="font-semibold">
                        Cổng điểm danh đã đóng để chốt số lượng.
                      </p>
                      <p className="mt-0.5 text-xs opacity-90">
                        Liên hệ admin nếu cần hỗ trợ.
                      </p>
                    </div>
                  ) : (
                    closingTime && (
                      <div className={`border-t px-5 py-2 text-center text-xs ${countdownToneClass}`}>
                        {isReminderOnly ? (
                          now > closingTime ? (
                            <span>
                              Đã qua mốc nhắc chốt sân (
                              <span className="font-bold tabular-nums">
                                {closingTime.toLocaleString("vi-VN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  day: "2-digit",
                                  month: "2-digit",
                                  timeZone: MATCH_TZ,
                                })}
                              </span>
                              ). Cổng vẫn nhận điểm danh.
                            </span>
                          ) : (
                            <span>
                              Mốc nhắc chốt sân lúc{" "}
                              <span className="font-bold tabular-nums">
                                {closingTime.toLocaleString("vi-VN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  day: "2-digit",
                                  month: "2-digit",
                                  timeZone: MATCH_TZ,
                                })}
                              </span>{" "}
                              (vẫn nhận điểm danh sau mốc này)
                            </span>
                          )
                        ) : (
                          <span>
                            Cổng đóng lúc{" "}
                            <span className="font-bold tabular-nums">
                              {closingTime.toLocaleString("vi-VN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "2-digit",
                                month: "2-digit",
                                timeZone: MATCH_TZ,
                              })}
                            </span>
                          </span>
                        )}
                      </div>
                    )
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Action buttons row */}
          <div className="mt-3 flex flex-wrap gap-2 justify-center">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <History className="h-4 w-4 mr-2" />
                  Lịch sử điểm danh
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    Lịch sử điểm danh ({attendanceHistory.length})
                  </DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto">
                  {attendanceHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      Chưa có hoạt động nào.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
                        <TableRow>
                          <TableHead className="w-[110px]">Hành động</TableHead>
                          <TableHead>Thành viên</TableHead>
                          <TableHead>Thiết bị & Mạng</TableHead>
                          <TableHead className="w-[120px]">Thời gian</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendanceHistory.map((entry, index) => {
                          const actionMeta: Record<
                            ActionType,
                            { label: string; className: string }
                          > = {
                            ATTEND: {
                              label: "✅ Điểm danh",
                              className:
                                "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                            },
                            NOT_ATTEND: {
                              label: "🚫 Báo vắng",
                              className:
                                "bg-red-100 text-red-700 hover:bg-red-100",
                            },
                            CANCEL_ATTEND: {
                              label: "↩️ Hủy điểm danh",
                              className:
                                "bg-amber-100 text-amber-800 hover:bg-amber-100",
                            },
                            CANCEL_NOT_ATTEND: {
                              label: "↩️ Hủy báo vắng",
                              className:
                                "bg-slate-100 text-slate-700 hover:bg-slate-100",
                            },
                          };
                          const meta = actionMeta[entry.type] || {
                            label: entry.type,
                            className: "bg-slate-100 text-slate-700",
                          };

                          const sameDeviceCount = entry.deviceId
                            ? attendanceHistory.filter((h) => h.deviceId === entry.deviceId).length
                            : 0;

                          return (
                            <TableRow key={index}>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className={meta.className}
                                >
                                  {meta.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-medium">
                                <div>{entry.memberName}</div>
                                {entry.isProxyAction && entry.actorName && (
                                  <div className="text-[11px] text-amber-600 dark:text-amber-400 font-normal mt-0.5">
                                    ⚠️ Bấm bởi: <b>{entry.actorName}</b>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                <div className="font-medium text-foreground">
                                  {entry.deviceModel || (entry.userAgent ? "Thiết bị di động" : "—")}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {entry.clientIp && (
                                    <span>IP: {entry.clientIp}</span>
                                  )}
                                  {sameDeviceCount > 1 && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/50 text-amber-600 dark:text-amber-400">
                                      {sameDeviceCount} lượt từ máy này
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {entry.timestamp?.seconds
                                  ? new Date(
                                      entry.timestamp.seconds * 1000
                                    ).toLocaleString("vi-VN", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      day: "2-digit",
                                      month: "2-digit",
                                      timeZone: MATCH_TZ,
                                    })
                                  : "--"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            {notifPermission === "default" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegisterNotification}
                disabled={isRegisteringNotif}
              >
                {isRegisteringNotif ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Bell className="h-4 w-4 mr-2" />
                )}
                Bật thông báo
              </Button>
            )}
          </div>
        </div>

        <Card className="mb-6 shadow-card sticky top-4 z-10 bg-background/80 backdrop-blur-sm">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm tên của bạn..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Repeat className="h-4 w-4" />
            <span>
              Nhấn icon{" "}
              <span className="font-medium text-foreground">lặp lại</span> để tự
              động điểm danh cho các trận đấu tiếp theo.
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredMembers.map((member) => {
            const isAttending = attendance.has(member.id);
            const isNotAttending = notAttendance.has(member.id);
            const isProcessing = isSubmitting.has(member.id);
            const isPinned = pinnedMembers.includes(member.id);
            return (
              <Card
                key={member.id}
                className={`shadow-card transition-all relative overflow-hidden ${
                  isAttending
                    ? "bg-green-100/20 border-green-500"
                    : isNotAttending
                    ? "bg-red-100/20 border-red-500"
                    : isPinned
                    ? "bg-blue-100/20 border-blue-500"
                    : "bg-card"
                }`}
              >
                <div className="absolute top-1 right-1 flex gap-1">
                  {/* Auto Attendance Toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await postApiJson(`/public/${groupId}/auto-attendance`, {
                            memberId: member.id,
                            enabled: !member.autoAttendance,
                          });
                          fetchMatchAndMembers();
                        }}
                      >
                        <Repeat
                          className={`h-4 w-4 ${
                            member.autoAttendance
                              ? "text-blue-500"
                              : "text-muted-foreground"
                          }`}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{member.autoAttendance ? "Tắt tự động điểm danh" : "Bật tự động điểm danh"}</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handlePinToggle(member.id)}
                      >
                        {isPinned ? (
                          <PinOff className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Pin className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{isPinned ? "Bỏ ghim thành viên" : "Ghim lên đầu danh sách"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <CardContent className="p-4 flex flex-col items-center text-center h-full w-full min-w-0">
                  <div className="flex-grow pt-4 w-full min-w-0 flex flex-col items-center">
                    <p className="font-bold text-foreground text-lg leading-tight truncate w-full px-1" title={member.name}>
                      {member.name}
                    </p>
                    <div className="min-h-[1.75rem] w-full min-w-0 flex items-center justify-center px-1">
                      {member.nickname && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex max-w-full cursor-help">
                              <Badge
                                variant="secondary"
                                className="max-w-full text-xs px-2.5 py-0.5 inline-flex items-center overflow-hidden"
                                title={member.nickname}
                              >
                                <span className="truncate block max-w-full">
                                  {member.nickname}
                                </span>
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>{member.nickname}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    {/* ELO Rating & Tier Badge */}
                    <div className="mt-1.5 mb-2 flex items-center justify-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                        ⚡ {member.elo ?? 1000}
                      </span>
                      {(() => {
                        const tierKey = member.eloTier || getEloTier(member.elo ?? 1000);
                        const tier = TIER_CONFIG[tierKey] || TIER_CONFIG.silver;
                        return (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0 h-4 font-normal",
                              tier.bgBadge
                            )}
                          >
                            {tier.icon} {tier.label}
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex gap-2 w-full mt-auto">
                    <Button
                      variant={isAttending ? "secondary" : "default"}
                      onClick={() =>
                        handleUpdateStatus(member.id, member.name, "attending")
                      }
                      disabled={
                        isProcessing ||
                        (isAttending && !isAttendanceClosed) ||
                        isAttendanceClosed
                      }
                      className="flex-1"
                    >
                      {isProcessing && !isNotAttending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isAttending ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Có
                        </>
                      ) : (
                        "Tham gia"
                      )}
                    </Button>
                    <Button
                      variant={isNotAttending ? "destructive" : "outline"}
                      onClick={() =>
                        handleUpdateStatus(
                          member.id,
                          member.name,
                          "not_attending"
                        )
                      }
                      disabled={
                        isProcessing ||
                        (isNotAttending && !isAttendanceClosed) ||
                        isAttendanceClosed
                      }
                      className="flex-1"
                    >
                      {isProcessing && !isAttending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isNotAttending ? (
                        <>
                          <X className="h-4 w-4 mr-1" />
                          Vắng
                        </>
                      ) : (
                        "Không"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {filteredMembers.length === 0 && !isLoading && (
          <div className="text-center py-12 text-muted-foreground col-span-full">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Không tìm thấy thành viên nào.</p>
          </div>
        )}

        {hasFeature(groupId, group, "teamPropose") && (<Card className="mt-10 shadow-card">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Chia đội kéo thả
                </CardTitle>
                <CardDescription>
                  Kéo người đã điểm danh vào từng đội để tự chia sân nhanh chóng.
                </CardDescription>
              </div>
              <Button
                onClick={handleSendTeamsClick}
                disabled={isSendingTeams}
                className="shrink-0"
              >
                {isSendingTeams ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Bell className="h-4 w-4 mr-2" />
                )}
                Gửi đội hình lên Slack
              </Button>

              {/* Passcode dialog */}
              <Dialog open={isPasscodeDialogOpen} onOpenChange={setIsPasscodeDialogOpen}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Nhập passcode</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <p className="text-sm text-muted-foreground">
                      Vui lòng nhập passcode để gửi đội hình lên Slack.
                    </p>
                    <div className="relative">
                      <Input
                        type={showPasscode ? "text" : "password"}
                        placeholder="Passcode..."
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendTeamsToSlack()}
                        className="pr-10 font-mono"
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowPasscode((v) => !v)}
                      >
                        {showPasscode ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        onClick={() => setIsPasscodeDialogOpen(false)}
                        disabled={isSendingTeams}
                      >
                        Hủy
                      </Button>
                      <Button
                        onClick={handleSendTeamsToSlack}
                        disabled={isSendingTeams || !passcode.trim()}
                      >
                        {isSendingTeams ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Bell className="h-4 w-4 mr-2" />
                        )}
                        Gửi
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm trong danh sách kéo thả..."
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 justify-between sm:justify-end">
                <Badge variant="outline" className="py-2">
                  {teamPool.length} người chờ
                </Badge>
                <Button
                  variant="outline"
                  onClick={handleAutoBalanceElo}
                  className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 font-semibold"
                >
                  <Sparkles className="h-4 w-4 mr-1.5 text-amber-500" />
                  Tự động chia theo ELO
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleResetTeams}
                  className="inline-flex"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Đưa tất cả về danh sách
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <Card
                className="shadow-card border-dashed"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleTeamDrop(e, "pool")}
              >
                <CardHeader>
                  <CardTitle className="text-lg">
                    Người đã điểm danh ({filteredTeamPool.length})
                  </CardTitle>
                  <CardDescription>
                    Kéo tên sang các cột đội bên cạnh.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 min-h-[220px] max-h-[420px] overflow-y-auto">
                  {filteredTeamPool.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      Chưa có ai trong danh sách kéo thả.
                    </div>
                  ) : (
                    filteredTeamPool.map((member) => (
                      <div
                        key={member.id}
                        draggable
                        onDragStart={(e) =>
                          handleTeamDragStart(e, member, "pool")
                        }
                        className="p-3 rounded-lg border bg-card cursor-move hover:shadow-md transition-all"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold leading-tight break-words">
                              {member.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {member.nickname && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] px-1.5 py-0 max-w-full truncate inline-block"
                                  title={member.nickname}
                                >
                                  {member.nickname}
                                </Badge>
                              )}
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                ⚡ {member.elo ?? 1000}
                              </span>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            Kéo
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {teams.length === 0 ? (
                <Card className="shadow-card lg:col-span-2 xl:col-span-3">
                  <CardContent className="p-6 text-muted-foreground">
                    Chưa có cấu hình đội cho trận này. Danh sách sẽ tự tạo khi
                    có điểm danh.
                  </CardContent>
                </Card>
              ) : (
                teams.map((team) => (
                  <Card
                    key={team.id}
                    className="shadow-card"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleTeamDrop(e, team.id)}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between text-base sm:text-lg">
                        <span>{team.name}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary">{team.members.length} người</Badge>
                          {team.members.length > 0 && (
                            <Badge
                              variant="outline"
                              className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30"
                            >
                              TB: {Math.round(team.members.reduce((sum, m) => sum + (m.elo ?? 1000), 0) / team.members.length)} ELO
                            </Badge>
                          )}
                        </div>
                      </CardTitle>
                      <CardDescription>
                        Kéo thành viên vào để hoàn thiện đội hình.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 min-h-[220px]">
                      {team.members.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          Chưa có ai trong đội này.
                        </div>
                      ) : (
                        team.members.map((member) => (
                          <div
                            key={member.id}
                            draggable
                            onDragStart={(e) =>
                              handleTeamDragStart(e, member, team.id)
                            }
                            className="p-3 rounded-lg border bg-card cursor-move hover:shadow-md transition-all"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium leading-tight break-words">
                                  {member.name}
                                </p>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  {member.nickname && (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1.5 py-0 max-w-full truncate inline-block"
                                      title={member.nickname}
                                    >
                                      {member.nickname}
                                    </Badge>
                                  )}
                                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                    ⚡ {member.elo ?? 1000}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </CardContent>
        </Card>)}
      </div>
    </div>
  );
};

export default Attendance;
