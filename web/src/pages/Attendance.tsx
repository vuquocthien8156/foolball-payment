import { useState, useEffect, useCallback, useMemo, DragEvent } from "react";
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
} from "lucide-react";
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  Timestamp,
  query,
  orderBy,
  where,
  limit,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import useLocalStorage from "@/hooks/useLocalStorage";

// Interfaces
interface Member {
  id: string;
  name: string;
  nickname?: string;
  autoAttendance?: boolean;
}

interface Match {
  id: string;
  date: Timestamp;
  totalAmount: number;
  isDeleted?: boolean;
  teamCount?: number;
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

interface Team {
  id: string;
  name: string;
  members: Member[];
}

const Attendance = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [match, setMatch] = useState<Match | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [attendance, setAttendance] = useState<Map<string, AttendanceRecord>>(
    new Map()
  );
  const [isSubmitting, setIsSubmitting] = useState<Set<string>>(new Set());
  const [attendanceHistory, setAttendanceHistory] = useState<
    AttendanceRecord[]
  >([]);
  const [pinnedMembers, setPinnedMembers] = useLocalStorage<string[]>(
    "pinnedMembers",
    []
  );
  const [teamPool, setTeamPool] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [teamBuilderInitialized, setTeamBuilderInitialized] = useState(false);

  const membersMap = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  );

  const { closingTime, isAttendanceClosed } = useMemo(() => {
    if (!match) return { closingTime: null, isAttendanceClosed: false };

    const matchDate = new Date(match.date.seconds * 1000);
    // Start of the match day (00:00)
    const matchDayStart = new Date(matchDate);
    matchDayStart.setHours(0, 0, 0, 0);

    // Closing time: 12 hours before start of match day = previous day 12:00 PM
    // This is equal to matchDayStart minus 12 hours.
    const closingDate = new Date(matchDayStart.getTime() - 12 * 60 * 60 * 1000);

    const now = new Date();
    // For testing: Uncomment logically if needed or rely on system time
    // const now = new Date("2025-12-19T13:00:00");

    return {
      closingTime: closingDate,
      isAttendanceClosed: now > closingDate,
    };
  }, [match]);

  useEffect(() => {
    if (!matchId) {
      setAttendanceHistory([]); // Clear history if no match
      return;
    }

    const attendanceQuery = query(
      collection(db, "matches", matchId, "attendance"),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(attendanceQuery, (snapshot) => {
      const history = snapshot.docs.map(
        (doc) => doc.data() as AttendanceRecord
      );
      setAttendanceHistory(history);
    });

    // Cleanup listener on component unmount or when matchId changes
    return () => unsubscribe();
  }, [matchId]);

  const fetchMatchAndMembers = useCallback(async () => {
    setIsLoading(true);
    try {
      // Find the latest match with PENDING status
      const matchesQuery = query(
        collection(db, "matches"),
        where("status", "==", "PENDING"),
        orderBy("createdAt", "desc"),
        limit(1)
      );
      const matchSnapshot = await getDocs(matchesQuery);

      const activeMatchDoc = matchSnapshot.docs.find(
        (doc) => !doc.data().isDeleted
      );

      if (!activeMatchDoc) {
        setMatch(null); // No pending match found
        setMatchId(null);
        setTeams([]);
        setTeamPool([]);
        setTeamBuilderInitialized(false);
        setTeamSearch("");
        return;
      }

      const latestMatchDoc = activeMatchDoc;
      const latestMatch = {
        id: latestMatchDoc.id,
        ...latestMatchDoc.data(),
      } as Match;
      setMatch(latestMatch);
      setMatchId(latestMatch.id);
      setTeams([]);
      setTeamPool([]);
      setTeamBuilderInitialized(false);
      setTeamSearch("");

      // Fetch all members
      const membersQuery = query(
        collection(db, "members"),
        orderBy("name", "asc")
      );
      const membersSnapshot = await getDocs(membersQuery);
      const membersList = membersSnapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Member)
      );
      setMembers(membersList);

      // Fetch attendance for this specific match
      const attendanceCollectionRef = collection(
        db,
        "matches",
        latestMatch.id,
        "attendance"
      );
      const attendanceSnapshot = await getDocs(attendanceCollectionRef);
      const attendanceMap = new Map<string, AttendanceRecord>();
      attendanceSnapshot.forEach((doc) => {
        attendanceMap.set(doc.id, doc.data() as AttendanceRecord);
      });
      setAttendance(attendanceMap);
    } catch (error) {
      console.error("Error fetching data: ", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể tải dữ liệu từ cơ sở dữ liệu.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchMatchAndMembers();
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

    // Sort pinned members to the top
    return filtered.sort((a, b) => {
      const isAPinned = pinnedMembers.includes(a.id);
      const isBPinned = pinnedMembers.includes(b.id);
      if (isAPinned && !isBPinned) return -1;
      if (!isAPinned && isBPinned) return 1;
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

  const handleAttendanceToggle = async (
    memberId: string,
    memberName: string
  ) => {
    if (!matchId || attendance.has(memberId)) return;

    setIsSubmitting((prev) => new Set(prev).add(memberId));
    const attendanceRef = doc(db, "matches", matchId, "attendance", memberId);

    try {
      // We only allow adding attendance, not removing.
      await runTransaction(db, async (transaction) => {
        const attendanceDoc = await transaction.get(attendanceRef);
        if (!attendanceDoc.exists()) {
          // Check again inside transaction to be safe
          const currentAttendanceQuery = collection(
            db,
            "matches",
            matchId,
            "attendance"
          );

          const currentAttendanceSnapshot = await getDocs(
            currentAttendanceQuery
          );
          transaction.set(attendanceRef, {
            timestamp: Timestamp.now(),
            memberName: memberName,
            userAgent: navigator.userAgent,
          });
        }
      });

      // Optimistic UI update
      setAttendance((prev) => {
        const newAttendance = new Map(prev);
        if (!newAttendance.has(memberId)) {
          newAttendance.set(memberId, {
            timestamp: Timestamp.now(),
            memberName,
            userAgent: navigator.userAgent,
          });
          toast({
            title: "Điểm danh thành công!",
            description: `Cảm ơn ${memberName} đã xác nhận.`,
          });
        }
        return newAttendance;
      });
    } catch (error) {
      console.error("Error toggling attendance:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể điểm danh. Vui lòng thử lại.",
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
    if (!match || teamBuilderInitialized || isLoading) return;
    initializeTeamsFromMatch();
  }, [initializeTeamsFromMatch, isLoading, match, teamBuilderInitialized]);

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
        <Button onClick={() => navigate("/public")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Quay lại
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8 text-center">
          <div className="inline-block p-4 bg-primary rounded-2xl shadow-card mb-4">
            <Users className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-foreground tracking-tight">
            Điểm danh ra sân
          </h1>
          <div className="flex items-center justify-center gap-2 mt-3 text-muted-foreground">
            <CalendarIcon className="h-5 w-5" />
            <span className="font-semibold text-lg">
              {new Date(match.date.seconds * 1000).toLocaleDateString("vi-VN")}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-2 items-center">
            {isAttendanceClosed ? (
              <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg border border-destructive/20 max-w-lg mx-auto">
                <p className="font-semibold">
                  Cổng điểm danh đã đóng để chốt số lượng.
                </p>
                <p className="text-sm mt-1 opacity-90">
                  Vui lòng liên hệ với admin hoặc người bạn quen biết của bạn để
                  biết thêm thông tin.
                </p>
              </div>
            ) : (
              closingTime && (
                <p className="text-muted-foreground">
                  Cổng điểm danh sẽ đóng vào lúc:{" "}
                  <span className="font-semibold text-foreground">
                    {closingTime.toLocaleString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </span>
                </p>
              )
            )}
          </div>

          <p className="text-xl font-bold mt-4">
            Số người đã điểm danh: {attendance.size}
          </p>
          <div className="mt-4">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <History className="h-4 w-4 mr-2" />
                  Xem lịch sử điểm danh
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    Lịch sử điểm danh ({attendanceHistory.length})
                  </DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
                      <TableRow>
                        <TableHead className="w-1/3">Thành viên</TableHead>
                        <TableHead className="w-1/3">Thời gian</TableHead>
                        <TableHead className="w-1/3">Thiết bị</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendanceHistory.map((record, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">
                            {record.memberName}
                          </TableCell>
                          <TableCell>
                            {new Date(
                              record.timestamp.seconds * 1000
                            ).toLocaleString("vi-VN")}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {record.userAgent}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </DialogContent>
            </Dialog>
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
            const isProcessing = isSubmitting.has(member.id);
            const isPinned = pinnedMembers.includes(member.id);
            return (
              <Card
                key={member.id}
                className={`shadow-card transition-all relative ${
                  isAttending
                    ? "bg-green-100/20 border-green-500"
                    : isPinned
                    ? "bg-blue-100/20 border-blue-500"
                    : "bg-card"
                }`}
              >
                <div className="absolute top-1 right-1 flex gap-1">
                  {/* Auto Attendance Toggle */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={
                      member.autoAttendance
                        ? "Tắt tự động điểm danh"
                        : "Bật tự động điểm danh"
                    }
                    onClick={async (e) => {
                      e.stopPropagation();
                      const memberRef = doc(db, "members", member.id);
                      await updateDoc(memberRef, {
                        autoAttendance: !member.autoAttendance,
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
                </div>
                <CardContent className="p-4 flex flex-col items-center text-center h-full">
                  <div className="flex-grow pt-4">
                    <p className="font-bold text-foreground text-lg leading-tight">
                      {member.name}
                    </p>
                    <div className="h-8 flex items-center justify-center">
                      {member.nickname && (
                        <Badge variant="secondary" className="mt-1 mb-3">
                          {member.nickname}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={isAttending ? "secondary" : "default"}
                    onClick={() =>
                      handleAttendanceToggle(member.id, member.name)
                    }
                    disabled={isProcessing || isAttending || isAttendanceClosed}
                    className="w-full mt-auto"
                  >
                    {isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isAttending ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Đã điểm danh
                      </>
                    ) : isAttendanceClosed ? (
                      "Đã đóng đơn"
                    ) : (
                      "Điểm danh"
                    )}
                  </Button>
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

        <Card className="mt-10 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Chia đội kéo thả
            </CardTitle>
            <CardDescription>
              Kéo người đã điểm danh vào từng đội để tự chia sân nhanh chóng.
            </CardDescription>
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
              <div className="flex items-center gap-2 justify-between sm:justify-end">
                <Badge variant="outline" className="py-2">
                  {teamPool.length} người chờ
                </Badge>
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
                          <div>
                            <p className="font-semibold leading-tight">
                              {member.name}
                            </p>
                            {member.nickname && (
                              <Badge
                                variant="secondary"
                                className="mt-1 text-xs"
                              >
                                {member.nickname}
                              </Badge>
                            )}
                          </div>
                          <Badge variant="outline" className="text-[10px]">
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
                      <CardTitle className="flex items-center justify-between text-lg">
                        <span>{team.name}</span>
                        <Badge variant="secondary">{team.members.length}</Badge>
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
                              <div>
                                <p className="font-medium leading-tight">
                                  {member.name}
                                </p>
                                {member.nickname && (
                                  <Badge
                                    variant="secondary"
                                    className="mt-1 text-xs"
                                  >
                                    {member.nickname}
                                  </Badge>
                                )}
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
        </Card>
      </div>
    </div>
  );
};

export default Attendance;
