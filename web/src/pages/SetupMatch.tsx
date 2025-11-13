import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  Copy,
  Trophy,
  Users,
  DollarSign,
  Percent,
  Loader2,
  Save,
  Search,
  MessageSquarePlus,
  CheckCircle2,
  Link as LinkIcon,
  RotateCcw,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// Interfaces
interface Member {
  id: string;
  name: string;
  nickname?: string;
  isCreditor?: boolean;
  isExemptFromPayment?: boolean;
  percent?: number;
  reason?: string;
}

interface Team {
  id: string;
  name: string;
  color: string;
  members: Member[];
  percent: number;
}

interface Share {
  memberId: string;
  teamId: string;
  amount: number;
  status: "PENDING" | "PAID" | "CANCELLED";
  orderCode: string;
  calculationDetails?: object;
  matchId?: string;
}

interface SavedTeamConfig {
  id: string;
  name: string;
  percent: number;
  members?: {
    id: string;
    percent?: number;
    reason?: string;
  }[];
  memberIds?: string[]; // For backward compatibility
}

interface MatchConfig {
  totalAmount: string | number;
  teamCount: 2 | 3;
  teamsConfig: SavedTeamConfig[];
  date?: Timestamp;
  status?: "PENDING" | "COMPLETED";
}

// Helper
const removeDiacritics = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
};

const SetupMatch = () => {
  const { matchId } = useParams();
  const navigate = useNavigate();

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [totalAmount, setTotalAmount] = useState("");
  const [teamCount, setTeamCount] = useState<2 | 3>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pool, setPool] = useState<Member[]>([]);
  const [attendance, setAttendance] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<Team[]>([
    { id: "A", name: "Đội A", color: "bg-blue-500", members: [], percent: 50 },
    { id: "B", name: "Đội B", color: "bg-red-500", members: [], percent: 50 },
    { id: "C", name: "Đội C", color: "bg-yellow-500", members: [], percent: 0 },
  ]);

  const activeTeams = teams.slice(0, teamCount);
  const totalPercent = activeTeams.reduce((sum, t) => sum + t.percent, 0);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const membersCollectionRef = collection(db, "members");
      const membersSnapshot = await getDocs(membersCollectionRef);
      const membersList = membersSnapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Member)
      );
      const membersMap = new Map(membersList.map((m) => [m.id, m]));

      let configSource: MatchConfig | null = null;

      if (matchId) {
        const matchRef = doc(db, "matches", matchId);
        const matchSnap = await getDoc(matchRef);
        if (matchSnap.exists()) {
          configSource = matchSnap.data() as MatchConfig;
          const attendanceCollectionRef = collection(
            db,
            "matches",
            matchId,
            "attendance"
          );
          const attendanceSnapshot = await getDocs(attendanceCollectionRef);
          const attendanceSet = new Set<string>();
          attendanceSnapshot.forEach((doc) => attendanceSet.add(doc.id));
          setAttendance(attendanceSet);
        } else {
          toast({
            variant: "destructive",
            title: "Lỗi",
            description: "Không tìm thấy trận đấu.",
          });
          navigate("/admin/setup");
        }
      } else {
        const configRef = doc(db, "configs", "last_match");
        const configSnap = await getDoc(configRef);
        if (configSnap.exists()) {
          configSource = configSnap.data() as MatchConfig;
        }
      }

      if (configSource) {
        const savedConfig = configSource;
        const defaultTeams = [
          {
            id: "A",
            name: "Đội A",
            color: "bg-blue-500",
            members: [],
            percent: 50,
          },
          {
            id: "B",
            name: "Đội B",
            color: "bg-red-500",
            members: [],
            percent: 50,
          },
          {
            id: "C",
            name: "Đội C",
            color: "bg-yellow-500",
            members: [],
            percent: 0,
          },
        ];

        const newTeams = defaultTeams.map((originalTeam) => {
          const savedTeam = savedConfig.teamsConfig.find(
            (st) => st.id === originalTeam.id
          );
          if (!savedTeam) return { ...originalTeam, members: [] };

          let newTeamMembers: Member[] = [];
          if (savedTeam.members) {
            newTeamMembers = savedTeam.members
              .map((savedMember) => {
                const member = membersMap.get(savedMember.id);
                return member
                  ? {
                      ...member,
                      percent: savedMember.percent,
                      reason: savedMember.reason,
                    }
                  : null;
              })
              .filter(Boolean) as Member[];
          } else if (savedTeam.memberIds) {
            newTeamMembers = savedTeam.memberIds
              .map((id) => membersMap.get(id))
              .filter(Boolean) as Member[];
          }

          return {
            ...originalTeam,
            name: savedTeam.name,
            percent: savedTeam.percent,
            members: newTeamMembers,
          };
        });

        const membersInNewTeams = new Set(
          newTeams.flatMap((t) => t.members.map((m) => m.id))
        );
        const newPool = membersList.filter((m) => !membersInNewTeams.has(m.id));

        setTotalAmount(
          savedConfig.totalAmount ? savedConfig.totalAmount.toString() : ""
        );
        setTeamCount(savedConfig.teamCount || 2);
        setTeams(newTeams);
        setPool(newPool);
        if (matchId && configSource.date) {
          const matchDate = (configSource.date as Timestamp).toDate();
          setDate(
            `${matchDate.getFullYear()}-${(matchDate.getMonth() + 1)
              .toString()
              .padStart(2, "0")}-${matchDate
              .getDate()
              .toString()
              .padStart(2, "0")}`
          );
        }
      } else {
        setPool(membersList);
      }
    } catch (error) {
      console.error("Error fetching data: ", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not fetch data.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [matchId, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDragStart = (
    e: React.DragEvent,
    member: Member,
    source: string
  ) => {
    e.dataTransfer.setData("member", JSON.stringify(member));
    e.dataTransfer.setData("source", source);
  };

  const handleDrop = (e: React.DragEvent, targetTeamId: string | "pool") => {
    e.preventDefault();
    const member: Member = JSON.parse(e.dataTransfer.getData("member"));
    const source = e.dataTransfer.getData("source");

    if (
      targetTeamId !== "pool" &&
      source === "pool" &&
      teams.some((team) => team.members.some((m) => m.id === member.id))
    ) {
      toast({ title: "Thành viên đã có trong đội", variant: "destructive" });
      return;
    }

    let nextPool = teams.some((t) => t.id === source)
      ? pool
      : pool.filter((m) => m.id !== member.id);
    let nextTeams = teams.map((t) =>
      t.id === source
        ? { ...t, members: t.members.filter((m) => m.id !== member.id) }
        : t
    );

    if (targetTeamId === "pool") {
      nextPool = [...nextPool, member];
    } else {
      nextTeams = nextTeams.map((t) =>
        t.id === targetTeamId ? { ...t, members: [...t.members, member] } : t
      );
    }

    setPool(nextPool);
    setTeams(nextTeams);
  };

  const handlePercentChange = (teamId: string, value: number) => {
    setTeams(
      teams.map((t) => (t.id === teamId ? { ...t, percent: value } : t))
    );
  };

  const handleTeamNameChange = (teamId: string, newName: string) => {
    setTeams(teams.map((t) => (t.id === teamId ? { ...t, name: newName } : t)));
  };

  const handleMemberPercentChange = (
    teamId: string,
    memberId: string,
    percent: number
  ) => {
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? {
              ...t,
              members: t.members.map((m) =>
                m.id === memberId
                  ? { ...m, percent: isNaN(percent) ? undefined : percent }
                  : m
              ),
            }
          : t
      )
    );
  };

  const handleMemberReasonChange = (
    teamId: string,
    memberId: string,
    reason: string
  ) => {
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? {
              ...t,
              members: t.members.map((m) =>
                m.id === memberId ? { ...m, reason } : m
              ),
            }
          : t
      )
    );
  };

  const calculatedShares = useMemo(() => {
    const numericTotalAmount = parseFloat(totalAmount) || 0;
    if (numericTotalAmount <= 0) return {};
    const memberAmounts: { [key: string]: number } = {};

    activeTeams.forEach((team) => {
      if (team.members.length === 0) return;
      const teamTotal = numericTotalAmount * (team.percent / 100);
      const fixedPercentMembers = team.members.filter(
        (m) =>
          !m.isExemptFromPayment && m.percent !== undefined && m.percent > 0
      );
      const regularMembers = team.members.filter(
        (m) =>
          !m.isExemptFromPayment && (m.percent === undefined || m.percent <= 0)
      );
      let totalFixedAmount = 0;

      fixedPercentMembers.forEach((member) => {
        const memberAmount = Math.round(
          teamTotal * ((member.percent || 0) / 100)
        );
        memberAmounts[member.id] = memberAmount;
        totalFixedAmount += memberAmount;
      });

      const remainingAmount = teamTotal - totalFixedAmount;
      if (regularMembers.length > 0 && remainingAmount >= 0) {
        const amountPerRegular = Math.floor(
          remainingAmount / regularMembers.length
        );
        let remainder = remainingAmount % regularMembers.length;
        regularMembers.forEach((member) => {
          memberAmounts[member.id] =
            amountPerRegular + (remainder-- > 0 ? 1 : 0);
        });
      }
    });

    const calculatedTotal = Object.values(memberAmounts).reduce(
      (sum, amount) => sum + amount,
      0
    );
    const diff = numericTotalAmount - calculatedTotal;
    if (diff !== 0 && Object.keys(memberAmounts).length > 0) {
      const lastMemberId = Object.keys(memberAmounts).pop();
      if (lastMemberId) memberAmounts[lastMemberId] += diff;
    }
    return memberAmounts;
  }, [activeTeams, totalAmount]);

  const handleSaveConfigToDb = async () => {
    setIsSavingConfig(true);
    try {
      const configToSave = {
        totalAmount: totalAmount || "0",
        teamCount,
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: t.percent,
          members: t.members.map((m) => ({
            id: m.id,
            percent: m.percent === undefined ? null : m.percent,
            reason: m.reason || null,
          })),
        })),
      };
      await setDoc(doc(db, "configs", "last_match"), configToSave);
      toast({
        title: "Đã lưu!",
        description: "Cấu hình trận đấu đã được lưu.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu cấu hình.",
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleUpdateMatchConfig = async () => {
    if (!matchId) return;
    setIsUpdatingConfig(true);
    try {
      const matchRef = doc(db, "matches", matchId);
      const matchData = {
        date: new Date(date),
        totalAmount: parseFloat(totalAmount) || 0,
        teamCount,
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: t.percent,
          members: t.members.map((m) => ({
            id: m.id,
            percent: m.percent === undefined ? null : m.percent,
            reason: m.reason || null,
          })),
        })),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(matchRef, matchData);
      toast({
        title: "Đã lưu!",
        description: "Cấu hình và đội hình đã được lưu.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu cấu hình.",
      });
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const handleCreateMatchForAttendance = async () => {
    setIsCreating(true);
    try {
      const matchRef = doc(collection(db, "matches"));
      const matchData = {
        date: new Date(date),
        totalAmount: parseFloat(totalAmount) || 0,
        teamCount,
        status: "PENDING",
        createdAt: serverTimestamp(),
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: t.percent,
          members: t.members.map((m) => ({
            id: m.id,
            percent: m.percent === undefined ? null : m.percent,
            reason: m.reason || null,
          })),
        })),
      };
      await setDoc(matchRef, matchData);
      const attendanceLink = `${window.location.origin}/attendance`;
      navigator.clipboard.writeText(attendanceLink);
      toast({
        title: "Tạo thành công!",
        description:
          "Đã tạo trận điểm danh. Link điểm danh chung đã được sao chép.",
      });
      navigate(`/admin/setup/${matchRef.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể tạo trận đấu.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleSave = async () => {
    if (totalPercent !== 100) {
      toast({
        title: "Lỗi phân chia",
        description: "Tổng phần trăm các đội phải bằng 100%",
        variant: "destructive",
      });
      return;
    }
    const numericTotalAmount = parseFloat(totalAmount);
    if (isNaN(numericTotalAmount) || numericTotalAmount <= 0) {
      toast({
        title: "Lỗi số tiền",
        description: "Vui lòng nhập tổng số tiền hợp lệ",
        variant: "destructive",
      });
      return;
    }
    await handleSaveConfigToDb();
    if (activeTeams.some((t) => t.percent > 0 && t.members.length === 0)) {
      toast({
        title: "Lỗi đội hình",
        description: "Đội có phần trăm > 0 phải có thành viên",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const matchRef = matchId
        ? doc(db, "matches", matchId)
        : doc(collection(db, "matches"));

      const shares: Share[] = [];
      const teamNames = activeTeams.reduce(
        (acc, t) => ({ ...acc, [t.id]: t.name }),
        {}
      );

      activeTeams.forEach((team) => {
        if (team.members.length === 0) return;
        const teamTotal = numericTotalAmount * (team.percent / 100);
        const fixedPercentMembers = team.members.filter(
          (m) => m.percent !== undefined && m.percent > 0
        );
        const regularMembers = team.members.filter(
          (m) =>
            !m.isExemptFromPayment &&
            (m.percent === undefined || m.percent <= 0)
        );
        let totalFixedAmount = 0;

        fixedPercentMembers.forEach((member) => {
          const memberAmount = Math.round(
            teamTotal * ((member.percent || 0) / 100)
          );
          shares.push({
            matchId: matchRef.id,
            memberId: member.id,
            teamId: team.id,
            amount: memberAmount,
            status: "PENDING",
            orderCode: "", // Will be generated by server
            calculationDetails: {
              memberPercent: member.percent,
              reason: member.reason,
              teamTotal,
              teamName: team.name,
            },
          });
          totalFixedAmount += memberAmount;
        });

        const remainingAmount = teamTotal - totalFixedAmount;
        if (regularMembers.length > 0 && remainingAmount >= 0) {
          const amountPerRegular = Math.floor(
            remainingAmount / regularMembers.length
          );
          let remainder = remainingAmount % regularMembers.length;
          regularMembers.forEach((member) => {
            const memberAmount = amountPerRegular + (remainder-- > 0 ? 1 : 0);
            shares.push({
              matchId: matchRef.id,
              memberId: member.id,
              teamId: team.id,
              amount: memberAmount,
              status: "PENDING",
              orderCode: "",
              calculationDetails: {
                teamTotal,
                teamName: team.name,
                totalFixedAmount,
                remainingAmount,
                regularMemberCount: regularMembers.length,
              },
            });
          });
        }
      });

      // Recalculate total and adjust for rounding errors
      const calculatedTotal = shares.reduce((sum, s) => sum + s.amount, 0);
      const diff = numericTotalAmount - calculatedTotal;
      if (diff !== 0 && shares.length > 0) {
        shares[shares.length - 1].amount += diff;
      }

      const batch = writeBatch(db);

      const matchData = {
        date: new Date(date),
        totalAmount: numericTotalAmount,
        teamCount,
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: t.percent,
          members: t.members.map((m) => ({
            id: m.id,
            percent: m.percent === undefined ? null : m.percent,
            reason: m.reason || null,
          })),
        })),
        status: "COMPLETED",
        updatedAt: serverTimestamp(),
      };

      if (matchId) {
        batch.update(matchRef, matchData);
      } else {
        batch.set(matchRef, { ...matchData, createdAt: serverTimestamp() });
      }

      // Delete existing shares if updating a match
      if (matchId) {
        const existingSharesQuery = collection(
          db,
          "matches",
          matchId,
          "shares"
        );
        const existingSharesSnapshot = await getDocs(existingSharesQuery);
        existingSharesSnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
      }

      shares.forEach((share) => {
        const shareRef = doc(collection(matchRef, "shares"));
        batch.set(shareRef, { ...share, createdAt: serverTimestamp() });
      });

      await batch.commit();
      toast({ title: "Thành công!", description: `Đã xử lý trận đấu.` });
    } catch (error) {
      toast({
        title: "Lỗi!",
        description: "Không thể lưu trận đấu.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const copyLink = (link: string, message: string) => {
    navigator.clipboard.writeText(link);
    toast({ title: "Đã sao chép!", description: message });
  };

  const handleLoadAttendance = () => {
    const attendingMembers = pool.filter((m) => attendance.has(m.id));
    if (attendingMembers.length === 0) {
      toast({ title: "Không có ai điểm danh" });
      return;
    }
    const remainingInPool = pool.filter((m) => !attendance.has(m.id));
    setTeams((currentTeams) => {
      const teamA = currentTeams.find((t) => t.id === "A");
      if (!teamA) return currentTeams;
      const newMembersForTeamA = attendingMembers.filter(
        (am) => !teamA.members.some((tm) => tm.id === am.id)
      );
      const updatedTeamA = {
        ...teamA,
        members: [...teamA.members, ...newMembersForTeamA],
      };
      return currentTeams.map((t) => (t.id === "A" ? updatedTeamA : t));
    });
    setPool(remainingInPool);
    toast({
      title: "Tải thành công!",
      description: `Đã thêm ${attendingMembers.length} thành viên vào Đội A.`,
    });
  };

  const handleReset = () => {
    const membersInTeams = teams.flatMap((t) => t.members);
    const newPool = [...pool, ...membersInTeams];
    const resetTeams = teams.map((t) => ({ ...t, members: [] }));

    setPool(newPool);
    setTeams(resetTeams);

    toast({
      title: "Đã reset!",
      description: "Tất cả thành viên đã được đưa về danh sách.",
    });
  };

  const filteredPool = useMemo(() => {
    if (!searchQuery) return pool;
    const lowerCaseQuery = removeDiacritics(searchQuery.toLowerCase());
    return pool.filter(
      (m) =>
        removeDiacritics(m.name.toLowerCase()).includes(lowerCaseQuery) ||
        (m.nickname &&
          removeDiacritics(m.nickname.toLowerCase()).includes(lowerCaseQuery))
    );
  }, [pool, searchQuery]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-primary rounded-xl shadow-card">
              <Trophy className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                {matchId ? "Chỉnh sửa trận đấu" : "Tạo trận đấu mới"}
              </h1>
              <p className="text-muted-foreground">
                {matchId
                  ? `ID: ${matchId}`
                  : "Phân chia đội và tính tiền tự động"}
              </p>
            </div>
          </div>
        </div>

        <Card className="mb-6 shadow-card">
          <CardHeader>
            <CardTitle>Thông tin trận đấu</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="date">Ngày đá</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="teamCount">Số đội</Label>
              <div className="flex gap-2">
                <Button
                  variant={teamCount === 2 ? "default" : "outline"}
                  onClick={() => setTeamCount(2)}
                  className="flex-1"
                >
                  2 đội
                </Button>
                <Button
                  variant={teamCount === 3 ? "default" : "outline"}
                  onClick={() => setTeamCount(3)}
                  className="flex-1"
                >
                  3 đội
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="total">Tổng tiền (VND)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="total"
                  type="number"
                  placeholder="500000"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tổng phần trăm</Label>
              <div className="flex items-center gap-2 h-10">
                <Badge
                  variant={totalPercent === 100 ? "default" : "destructive"}
                  className="text-lg px-4 py-2"
                >
                  {totalPercent}%
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />
              Phân chia tỷ lệ
            </CardTitle>
            <CardDescription>
              Điều chỉnh tên và tỷ lệ chia tiền cho mỗi đội.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            {activeTeams.map((team) => (
              <div key={team.id} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`name-${team.id}`}>Tên đội</Label>
                  <Input
                    id={`name-${team.id}`}
                    value={team.name}
                    onChange={(e) =>
                      handleTeamNameChange(team.id, e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`percent-${team.id}`}>Tỷ lệ (%)</Label>
                  <Input
                    id={`percent-${team.id}`}
                    type="number"
                    min="0"
                    max="100"
                    value={team.percent}
                    onChange={(e) =>
                      handlePercentChange(
                        team.id,
                        parseInt(e.target.value) || 0
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card
            className="shadow-card"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, "pool")}
          >
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Danh sách ({filteredPool.length})
              </CardTitle>
              <CardDescription>
                Có {attendance.size} thành viên đã điểm danh.
              </CardDescription>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleReset}
                  className="w-full"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset Đội
                </Button>
              </div>
              <div className="relative pt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm thành viên..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 min-h-[300px] overflow-y-auto max-h-[500px]">
              {isLoading ? (
                <div className="flex justify-center items-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                filteredPool.map((member) => (
                  <div
                    key={member.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, member, "pool")}
                    className="p-3 rounded-lg border bg-card cursor-move hover:shadow-md transition-all"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">{member.name}</p>
                        {member.nickname && (
                          <Badge variant="secondary" className="mt-1 text-xs">
                            {member.nickname}
                          </Badge>
                        )}
                      </div>
                      {attendance.has(member.id) && (
                        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {activeTeams.map((team) => (
            <Card
              key={team.id}
              className="shadow-card"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, team.id)}
            >
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className={`h-4 w-4 rounded-full ${team.color}`} />
                  {team.name} ({team.members.length})
                </CardTitle>
                <CardDescription>
                  {team.percent}% ={" "}
                  {totalAmount
                    ? (
                        (parseFloat(totalAmount) * team.percent) /
                        100
                      ).toLocaleString()
                    : "0"}{" "}
                  VND
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 min-h-[300px]">
                {team.members.map((member) => (
                  <div
                    key={member.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, member, team.id)}
                    className="p-3 rounded-lg border bg-card cursor-move hover:shadow-md transition-all space-y-2"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">{member.name}</p>
                        {member.nickname && (
                          <Badge variant="secondary" className="mt-1 text-xs">
                            {member.nickname}
                          </Badge>
                        )}
                      </div>
                      {attendance.has(member.id) && (
                        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                      )}
                      <div className="font-semibold text-primary">
                        {calculatedShares[member.id]
                          ? `${Math.round(
                              calculatedShares[member.id]
                            ).toLocaleString()}đ`
                          : "0đ"}
                      </div>
                    </div>
                    {member.isExemptFromPayment ? (
                      <Badge
                        variant="outline"
                        className="w-full justify-center"
                      >
                        Miễn chia tiền
                      </Badge>
                    ) : (
                      <>
                        <div className="relative">
                          <Percent className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                          <Input
                            type="number"
                            placeholder="Chia đều"
                            value={member.percent || ""}
                            onChange={(e) =>
                              handleMemberPercentChange(
                                team.id,
                                member.id,
                                parseInt(e.target.value)
                              )
                            }
                            className="pl-7 h-8 text-sm"
                          />
                        </div>
                        {(member.percent || 0) > 0 && (
                          <div className="relative">
                            <MessageSquarePlus className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input
                              type="text"
                              placeholder="Lý do (vd: đá ít)"
                              value={member.reason || ""}
                              onChange={(e) =>
                                handleMemberReasonChange(
                                  team.id,
                                  member.id,
                                  e.target.value
                                )
                              }
                              className="pl-7 h-8 text-sm"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-end">
          <Button
            variant="outline"
            onClick={() =>
              copyLink(
                `${window.location.origin}/pay`,
                "Link thanh toán chung đã được sao chép."
              )
            }
            disabled={isSaving}
          >
            <Copy className="h-4 w-4 mr-2" />
            Sao chép link thanh toán chung
          </Button>
          <Button
            onClick={handleCreateMatchForAttendance}
            disabled={isCreating || !!matchId}
            variant="default"
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <LinkIcon className="h-4 w-4 mr-2" />
            )}
            Tạo & Lấy Link Điểm Danh
          </Button>
          <Button
            onClick={handleSaveConfigToDb}
            disabled={isSavingConfig || isSaving}
            variant="secondary"
          >
            {isSavingConfig ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Lưu Cấu Hình
          </Button>

          {matchId ? (
            <>
              <Button
                onClick={handleUpdateMatchConfig}
                disabled={isUpdatingConfig || isSaving}
                variant="secondary"
              >
                {isUpdatingConfig ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Cập nhật
              </Button>
              <Button onClick={handleSave} size="lg" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Đang xử lý...
                  </>
                ) : (
                  "Tính tiền & Hoàn tất"
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleSave} size="lg" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                "Tính tiền & Lưu trận"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetupMatch;
