import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "firebase/firestore";
import { db } from "@/lib/firebase";

interface Member {
  id: string;
  name: string;
  nickname?: string;
  isCreditor?: boolean;
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
}

// Helper function to remove Vietnamese diacritics
const removeDiacritics = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
};

const SetupMatch = () => {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [totalAmount, setTotalAmount] = useState("");
  const [teamCount, setTeamCount] = useState<2 | 3>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [pool, setPool] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([
    { id: "A", name: "Đội A", color: "bg-blue-500", members: [], percent: 50 },
    { id: "B", name: "Đội B", color: "bg-red-500", members: [], percent: 50 },
    { id: "C", name: "Đội C", color: "bg-yellow-500", members: [], percent: 0 },
  ]);

  const activeTeams = teams.slice(0, teamCount);
  const totalPercent = activeTeams.reduce((sum, t) => sum + t.percent, 0);

  const fetchMembers = useCallback(async () => {
    setIsLoading(true);
    try {
      const membersCollectionRef = collection(db, "members");
      const querySnapshot = await getDocs(membersCollectionRef);
      const membersList = querySnapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          } as Member)
      );

      // Load last config from Firestore
      const configRef = doc(db, "configs", "last_match");
      const configSnap = await getDoc(configRef);

      if (configSnap.exists()) {
        const savedConfig = configSnap.data();
        const membersMap = new Map(membersList.map((m) => [m.id, m]));

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
            (st: { id: string }) => st.id === originalTeam.id
          );
          if (!savedTeam) return { ...originalTeam, members: [] };

          const newTeamMembers = savedTeam.memberIds
            .map((id: string) => membersMap.get(id))
            .filter(Boolean) as Member[];

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

        setTotalAmount(savedConfig.totalAmount || "");
        setTeamCount(savedConfig.teamCount || 2);
        setTeams(newTeams);
        setPool(newPool);
      } else {
        // If no saved config, just load the members into the pool
        setPool(membersList);
        // And reset teams to default state
        setTeams([
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
        ]);
      }
    } catch (error) {
      console.error("Error fetching members: ", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not fetch members from the database.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

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

    if (targetTeamId !== "pool") {
      const isAlreadyInATeam = teams.some((team) =>
        team.members.some((m) => m.id === member.id)
      );
      if (isAlreadyInATeam && source === "pool") {
        toast({
          title: "Thành viên đã có trong đội",
          description: `${member.name} đã được phân vào một đội khác.`,
          variant: "destructive",
        });
        return;
      }
    }

    let nextPool = pool;
    let nextTeams = teams;

    if (source === "pool") {
      nextPool = pool.filter((m) => m.id !== member.id);
    } else {
      nextTeams = teams.map((t) =>
        t.id === source
          ? { ...t, members: t.members.filter((m) => m.id !== member.id) }
          : t
      );
    }

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
          memberIds: t.members.map((m) => m.id),
        })),
      };
      const configRef = doc(db, "configs", "last_match");
      await setDoc(configRef, configToSave);
      toast({
        title: "Đã lưu!",
        description: "Cấu hình trận đấu đã được lưu.",
      });
    } catch (e) {
      console.error("Could not save config to Firestore", e);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu cấu hình vào cơ sở dữ liệu.",
      });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleSave = async () => {
    // Validations
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
    for (const team of activeTeams) {
      if (team.percent > 0 && team.members.length === 0) {
        toast({
          title: "Lỗi đội hình",
          description: `${team.name} có phần trăm > 0 nhưng chưa có thành viên`,
          variant: "destructive",
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      // Also save the config to DB when creating a match
      await handleSaveConfigToDb();

      // --- Money Calculation Logic ---
      const shares: Share[] = [];
      let calculatedTotal = 0;

      activeTeams.forEach((team) => {
        if (team.members.length === 0) return;

        const teamTotal = numericTotalAmount * (team.percent / 100);
        const amountPerMember = Math.floor(teamTotal / team.members.length);
        let remainder = teamTotal % team.members.length;

        team.members.forEach((member, index) => {
          const finalAmount = amountPerMember + (remainder > 0 ? 1 : 0);
          shares.push({
            memberId: member.id,
            teamId: team.id,
            amount: finalAmount,
            status: member.isCreditor ? "PAID" : "PENDING",
            orderCode: "", // Will be generated later
          });
          calculatedTotal += finalAmount;
          if (remainder > 0) {
            remainder--;
          }
        });
      });

      // Adjust for rounding errors to match totalAmount
      const diff = numericTotalAmount - calculatedTotal;
      if (diff !== 0 && shares.length > 0) {
        shares[shares.length - 1].amount += diff;
      }

      // --- Firestore Batch Write ---
      const batch = writeBatch(db);

      // 1. Create match document
      const matchRef = doc(collection(db, "matches"));
      const teamPercents = activeTeams.reduce((acc, team) => {
        acc[team.id] = team.percent;
        return acc;
      }, {} as { [key: string]: number });
      const teamNames = activeTeams.reduce((acc, team) => {
        acc[team.id] = team.name;
        return acc;
      }, {} as { [key: string]: string });

      batch.set(matchRef, {
        date: new Date(date),
        totalAmount: numericTotalAmount,
        teamCount: teamCount,
        teamPercents: teamPercents,
        teamNames: teamNames,
        createdAt: serverTimestamp(),
      });

      // 2. Create roster documents
      activeTeams.forEach((team) => {
        const rosterRef = doc(db, "matches", matchRef.id, "rosters", team.id);
        batch.set(rosterRef, {
          memberIds: team.members.map((m) => m.id),
        });
      });

      // 3. Create share documents
      shares.forEach((share) => {
        const shareRef = doc(collection(db, "matches", matchRef.id, "shares"));
        batch.set(shareRef, {
          ...share,
          matchId: matchRef.id,
          orderCode: `MATCH_${matchRef.id}_MEM_${share.memberId}`,
          createdAt: serverTimestamp(),
        });
      });

      await batch.commit();

      // --- Send Notification ---
      try {
        const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
        await fetch(`${API_URL}/send-match-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ matchId: matchRef.id }),
        });
      } catch (notificationError) {
        console.error("Failed to send notification:", notificationError);
        // Don't block the success toast for this, just log it.
      }

      toast({
        title: "Thành công!",
        description: `Đã tạo trận đấu và ${shares.length} lượt thanh toán.`,
      });
    } catch (error) {
      console.error("Error saving match:", error);
      toast({
        title: "Lỗi!",
        description: "Không thể lưu trận đấu. Vui lòng thử lại.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/pay`);
    toast({
      title: "Đã sao chép!",
      description: "Link thanh toán chung đã được sao chép.",
    });
  };

  const filteredPool = useMemo(() => {
    if (!searchQuery) {
      return pool;
    }
    const lowerCaseQuery = removeDiacritics(searchQuery.toLowerCase());
    return pool.filter(
      (member) =>
        removeDiacritics(member.name.toLowerCase()).includes(lowerCaseQuery) ||
        (member.nickname &&
          removeDiacritics(member.nickname.toLowerCase()).includes(
            lowerCaseQuery
          ))
    );
  }, [pool, searchQuery]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-gradient-pitch rounded-xl shadow-card">
              <Trophy className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Tạo trận đấu mới
              </h1>
              <p className="text-muted-foreground">
                Phân chia đội và tính tiền tự động
              </p>
            </div>
          </div>
        </div>

        {/* Match Info */}
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

        {/* Team Percentages */}
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

        {/* Drag & Drop Board */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          {/* Pool */}
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
                    <p className="font-medium">{member.name}</p>
                    {member.nickname && (
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {member.nickname}
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Teams */}
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
                    className="p-3 rounded-lg border bg-card cursor-move hover:shadow-md transition-all"
                  >
                    <p className="font-medium">{member.name}</p>
                    {member.nickname && (
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {member.nickname}
                      </Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-end">
          <Button variant="outline" onClick={copyLink} disabled={isSaving}>
            <Copy className="h-4 w-4 mr-2" />
            Sao chép link thanh toán
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
        </div>
      </div>
    </div>
  );
};

export default SetupMatch;
