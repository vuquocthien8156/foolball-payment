import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Check,
  Loader2,
  Search,
  Users,
  Calendar as CalendarIcon,
  ArrowLeft,
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
} from "firebase/firestore";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";

// Interfaces
interface Member {
  id: string;
  name: string;
  nickname?: string;
}

interface Match {
  id: string;
  date: Timestamp;
  totalAmount: number;
}

interface AttendanceRecord {
  timestamp: Timestamp;
  memberName: string;
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

      if (matchSnapshot.empty) {
        setMatch(null); // No pending match found
        setMatchId(null);
        return;
      }

      const latestMatchDoc = matchSnapshot.docs[0];
      const latestMatch = {
        id: latestMatchDoc.id,
        ...latestMatchDoc.data(),
      } as Match;
      setMatch(latestMatch);
      setMatchId(latestMatch.id);

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

  const filteredMembers = useMemo(
    () =>
      members.filter((m) => {
        const lowerCaseSearch = removeDiacritics(search.toLowerCase());
        return (
          removeDiacritics(m.name.toLowerCase()).includes(lowerCaseSearch) ||
          (m.nickname &&
            removeDiacritics(m.nickname.toLowerCase()).includes(
              lowerCaseSearch
            ))
        );
      }),
    [members, search]
  );

  const handleAttendanceToggle = async (
    memberId: string,
    memberName: string
  ) => {
    if (!matchId) return;
    setIsSubmitting((prev) => new Set(prev).add(memberId));
    const attendanceRef = doc(db, "matches", matchId, "attendance", memberId);

    try {
      await runTransaction(db, async (transaction) => {
        const attendanceDoc = await transaction.get(attendanceRef);
        if (attendanceDoc.exists()) {
          transaction.delete(attendanceRef);
        } else {
          transaction.set(attendanceRef, {
            timestamp: Timestamp.now(),
            memberName: memberName,
          });
        }
      });

      setAttendance((prev) => {
        const newAttendance = new Map(prev);
        if (newAttendance.has(memberId)) {
          newAttendance.delete(memberId);
          toast({
            title: "Huỷ điểm danh",
            description: `${memberName} đã được huỷ điểm danh.`,
          });
        } else {
          newAttendance.set(memberId, {
            timestamp: Timestamp.now(),
            memberName,
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
        description: "Không thể cập nhật điểm danh. Vui lòng thử lại.",
      });
    } finally {
      setIsSubmitting((prev) => {
        const newSubmitting = new Set(prev);
        newSubmitting.delete(memberId);
        return newSubmitting;
      });
    }
  };

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
        <Button onClick={() => navigate("/")}>
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
          <div className="inline-block p-4 bg-gradient-pitch rounded-2xl shadow-card mb-4">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredMembers.map((member) => {
            const isAttending = attendance.has(member.id);
            const isProcessing = isSubmitting.has(member.id);
            return (
              <Card
                key={member.id}
                className={`shadow-card transition-all ${
                  isAttending ? "bg-green-100/20 border-green-500" : "bg-card"
                }`}
              >
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="h-16 w-16 mb-3 rounded-full bg-gradient-pitch flex items-center justify-center text-white font-bold shadow-card text-2xl">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <p className="font-bold text-foreground text-lg leading-tight">
                    {member.name}
                  </p>
                  {member.nickname && (
                    <Badge variant="secondary" className="mt-1 mb-3">
                      {member.nickname}
                    </Badge>
                  )}
                  <Button
                    variant={isAttending ? "secondary" : "default"}
                    onClick={() =>
                      handleAttendanceToggle(member.id, member.name)
                    }
                    disabled={isProcessing}
                    className="w-full mt-4"
                  >
                    {isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isAttending ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Huỷ
                      </>
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
      </div>
    </div>
  );
};

export default Attendance;
