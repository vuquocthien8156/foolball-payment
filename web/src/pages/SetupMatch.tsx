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
import { Switch } from "@/components/ui/switch";
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
  MapPin,
  Clock,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { postApiJson } from "@/lib/api";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";

// Interfaces
interface Member {
  id: string;
  name: string;
  nickname?: string;
  isExemptFromPayment?: boolean;
  percent?: number;
  reason?: string;
  inactive?: boolean;
  isPriority?: boolean;
}

interface Team {
  id: string;
  name: string;
  color: string;
  members: Member[];
  percent: number;
}

interface ExpenseItem {
  id: string;
  description: string;
  amount: number;
  exemptMemberIds: string[];
  teamPercents?: { [teamId: string]: number };
  type?: "SHARED" | "INDIVIDUAL" | "EQUAL";
  targetMemberId?: string;
}

interface Share {
  memberId: string;
  teamId: string;
  amount: number;
  status: "PENDING" | "PAID" | "CANCELLED";
  orderCode: string;
  calculationDetails?: {
    memberPercent?: number;
    reason?: string;
    teamName?: string;
    teamTotal?: number;
    totalFixedAmount?: number;
    remainingAmount?: number;
    regularMemberCount?: number;
  };
  matchId?: string;
  expenseBreakdown?: {
    expenseId: string;
    description: string;
    amount: number;
  }[];
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
  totalAmount?: string | number; // Keep for backward compatibility
  expenseItems?: ExpenseItem[];
  teamCount: 2 | 3;
  teamsConfig: SavedTeamConfig[];
  date?: Timestamp;
  status?: "PENDING" | "COMPLETED";
  isTest?: boolean;
  venueName?: string;
  mapIframe?: string;
  attendanceCloseHours?: number;
  paidByMemberId?: string | null;
  skipAutoAttendance?: boolean;
  sufficientPlayerCount?: number;
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

  // Default to today in the user's local timezone.
  // toISOString() returns UTC — between 00:00–07:00 ICT it would land on
  // yesterday for users in GMT+7.
  const todayLocalKey = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const [date, setDate] = useState(todayLocalKey);
  const [time, setTime] = useState("19:00");
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([
    { id: "default", description: "Tiền sân", amount: 0, exemptMemberIds: [], teamPercents: { A: 50, B: 50, C: 0 }, type: "SHARED" },
  ]);
  const [teamCount, setTeamCount] = useState<2 | 3>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [existingStatus, setExistingStatus] = useState<
    "PENDING" | "COMPLETED" | undefined
  >("PENDING");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTestMatch, setIsTestMatch] = useState(false);
  const [skipAutoAttendance, setSkipAutoAttendance] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [mapIframe, setMapIframe] = useState("");
  const [attendanceCloseHours, setAttendanceCloseHours] = useState(12);
  const [sufficientPlayerCount, setSufficientPlayerCount] = useState<number | "">(14);
  const [paidByMemberId, setPaidByMemberId] = useState<string>("");
  const [paidByPopoverOpen, setPaidByPopoverOpen] = useState(false);
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [pool, setPool] = useState<Member[]>([]);
  const [attendance, setAttendance] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<Team[]>([
    { id: "A", name: "Đội A", color: "bg-blue-500", members: [], percent: 50 },
    { id: "B", name: "Đội B", color: "bg-red-500", members: [], percent: 50 },
    { id: "C", name: "Đội C", color: "bg-yellow-500", members: [], percent: 0 },
  ]);

  const activeTeams = teams.slice(0, teamCount);
  const totalPercent = activeTeams.reduce((sum, t) => sum + t.percent, 0);

  const getTeamEffectivePercent = (teamId: string) => {
    const totalExpenseAmount = expenseItems.reduce((sum, e) => sum + e.amount, 0);
    if (totalExpenseAmount <= 0) return teamId === "C" ? 0 : 50;

    const teamTotalAmount = expenseItems.reduce((sum, expense) => {
      if (expense.amount <= 0) return sum;
      if (expense.type === "INDIVIDUAL") return sum;
      const teamPercent = expense.teamPercents?.[teamId] ?? (teams.find(t => t.id === teamId)?.percent ?? 0);
      return sum + (expense.amount * teamPercent) / 100;
    }, 0);

    return Math.round((teamTotalAmount / totalExpenseAmount) * 100);
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const membersCollectionRef = collection(db, "members");
      const membersSnapshot = await getDocs(membersCollectionRef);
      const membersList = membersSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Member))
        .filter((m) => !m.inactive);
      const membersMap = new Map(membersList.map((m) => [m.id, m]));
      setAllMembers(membersList);

      let configSource: MatchConfig | null = null;

      if (matchId) {
        const matchRef = doc(db, "matches", matchId);
        const matchSnap = await getDoc(matchRef);
        if (matchSnap.exists()) {
          configSource = matchSnap.data() as MatchConfig;
          if ((configSource as any).status) {
            setExistingStatus((configSource as any).status);
          }
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

        const initialTeamPercents = savedConfig.teamsConfig?.reduce((acc, team) => {
          acc[team.id] = team.percent;
          return acc;
        }, {} as { [teamId: string]: number }) || { A: 50, B: 50, C: 0 };

        // Backward compatibility: convert old totalAmount to expenseItems
        if (savedConfig.expenseItems && savedConfig.expenseItems.length > 0) {
          setExpenseItems(
            savedConfig.expenseItems.map((item) => ({
              ...item,
              type: item.type || "SHARED",
              teamPercents: item.teamPercents || { ...initialTeamPercents },
            }))
          );
        } else if (savedConfig.totalAmount) {
          // Old format: convert totalAmount to single expense item
          setExpenseItems([
            {
              id: "default",
              description: "Tiền sân",
              amount: parseFloat(savedConfig.totalAmount.toString()) || 0,
              exemptMemberIds: [],
              type: "SHARED",
              teamPercents: { ...initialTeamPercents },
            },
          ]);
        } else {
          setExpenseItems([
            { id: "default", description: "Tiền sân", amount: 0, exemptMemberIds: [], type: "SHARED", teamPercents: { ...initialTeamPercents } },
          ]);
        }

        setTeamCount(savedConfig.teamCount || 2);
        setIsTestMatch(savedConfig.isTest || false);
        setVenueName(savedConfig.venueName || "");
        setMapIframe(savedConfig.mapIframe || "");
        setAttendanceCloseHours(savedConfig.attendanceCloseHours ?? 12);
        setSufficientPlayerCount(savedConfig.sufficientPlayerCount ?? 14);
        setPaidByMemberId(savedConfig.paidByMemberId || "");
        setSkipAutoAttendance(savedConfig.skipAutoAttendance || false);
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
          setTime(
            `${matchDate.getHours().toString().padStart(2, "0")}:${matchDate
              .getMinutes()
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

  const handleAddExpense = () => {
    const defaultPercents: { [teamId: string]: number } = {};
    if (teamCount === 2) {
      defaultPercents["A"] = 50;
      defaultPercents["B"] = 50;
      defaultPercents["C"] = 0;
    } else {
      defaultPercents["A"] = 34;
      defaultPercents["B"] = 33;
      defaultPercents["C"] = 33;
    }
    const newExpense: ExpenseItem = {
      id: `expense-${Date.now()}`,
      description: "",
      amount: 0,
      exemptMemberIds: [],
      type: "SHARED",
      teamPercents: defaultPercents,
    };
    setExpenseItems([...expenseItems, newExpense]);
  };

  const handleRemoveExpense = (expenseId: string) => {
    if (expenseItems.length <= 1) {
      toast({
        title: "Lỗi",
        description: "Phải có ít nhất một khoản chi phí.",
        variant: "destructive",
      });
      return;
    }
    setExpenseItems(expenseItems.filter((e) => e.id !== expenseId));
  };

  const handleUpdateExpense = (
    expenseId: string,
    field: keyof ExpenseItem,
    value: any
  ) => {
    setExpenseItems((prev) =>
      prev.map((e) => (e.id === expenseId ? { ...e, [field]: value } : e))
    );
  };

  const calculatedShares = useMemo(() => {
    const totalExpenseAmount = expenseItems.reduce((sum, e) => sum + e.amount, 0);
    const memberAmounts: { [key: string]: { totalAmount: number; details: { description: string; amount: number }[] } } = {};

    if (totalExpenseAmount <= 0) return memberAmounts;

    // Loop through each expense
    expenseItems.forEach((expense) => {
      if (expense.amount <= 0) return;

      if (expense.type === "INDIVIDUAL") {
        if (expense.targetMemberId) {
          if (!memberAmounts[expense.targetMemberId]) {
            memberAmounts[expense.targetMemberId] = { totalAmount: 0, details: [] };
          }
          memberAmounts[expense.targetMemberId].totalAmount += expense.amount;
          memberAmounts[expense.targetMemberId].details.push({
            description: (expense.description || "Đòi riêng") + " (Đòi riêng)",
            amount: expense.amount,
          });
        }
        return;
      }

      if (expense.type === "EQUAL") {
        const eligibleMembers: Member[] = [];
        activeTeams.forEach((team) => {
          team.members.forEach((m) => {
            if (!m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)) {
              eligibleMembers.push(m);
            }
          });
        });

        if (eligibleMembers.length > 0) {
          const amountPerMember = Math.floor(expense.amount / eligibleMembers.length);
          let remainder = expense.amount % eligibleMembers.length;

          eligibleMembers.forEach((member) => {
            const memberAmount = amountPerMember + (remainder-- > 0 ? 1 : 0);
            if (!memberAmounts[member.id]) {
              memberAmounts[member.id] = { totalAmount: 0, details: [] };
            }
            memberAmounts[member.id].totalAmount += memberAmount;
            memberAmounts[member.id].details.push({
              description: expense.description || "Chia đều",
              amount: memberAmount,
            });
          });
        }
        return;
      }

      activeTeams.forEach((team) => {
        if (team.members.length === 0) return;

        // Filter members eligible for this expense (not exempt and not globally exempt)
        const eligibleMembers = team.members.filter(
          (m) => !m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)
        );

        if (eligibleMembers.length === 0) return;

        const teamPercent = expense.teamPercents?.[team.id] ?? team.percent;
        const teamTotal = expense.amount * (teamPercent / 100);

        const fixedPercentMembers = eligibleMembers.filter(
          (m) => m.percent !== undefined && m.percent > 0
        );
        const regularMembers = eligibleMembers.filter(
          (m) => m.percent === undefined || m.percent <= 0
        );

        let totalFixedAmount = 0;

        fixedPercentMembers.forEach((member) => {
          const memberAmount = Math.round(
            teamTotal * ((member.percent || 0) / 100)
          );
          if (!memberAmounts[member.id]) {
            memberAmounts[member.id] = { totalAmount: 0, details: [] };
          }
          memberAmounts[member.id].totalAmount += memberAmount;
          memberAmounts[member.id].details.push({
            description: expense.description || "Tiền sân",
            amount: memberAmount,
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
            if (!memberAmounts[member.id]) {
              memberAmounts[member.id] = { totalAmount: 0, details: [] };
            }
            memberAmounts[member.id].totalAmount += memberAmount;
            memberAmounts[member.id].details.push({
              description: expense.description || "Tiền sân",
              amount: memberAmount,
            });
          });
        }
      });
    });

    // Adjust for rounding errors
    const calculatedTotal = Object.values(memberAmounts).reduce(
      (sum, item) => sum + item.totalAmount,
      0
    );
    const diff = totalExpenseAmount - calculatedTotal;
    if (diff !== 0 && Object.keys(memberAmounts).length > 0) {
      const lastMemberId = Object.keys(memberAmounts).pop();
      if (lastMemberId) {
        memberAmounts[lastMemberId].totalAmount += diff;
        const lastDetail = memberAmounts[lastMemberId].details[memberAmounts[lastMemberId].details.length - 1];
        if (lastDetail) {
          lastDetail.amount += diff;
        }
      }
    }
    return memberAmounts;
  }, [activeTeams, expenseItems, teams]);

  const matchDivisionDetails = useMemo(() => {
    const teamShares = activeTeams.map((team) => {
      const amount = team.members.reduce(
        (sum, m) => sum + (calculatedShares[m.id]?.totalAmount || 0),
        0
      );
      return { name: team.name, amount };
    });

    const activeMemberIds = new Set(activeTeams.flatMap((t) => t.members.map((m) => m.id)));
    const otherShares: { name: string; amount: number }[] = [];
    
    Object.entries(calculatedShares).forEach(([memberId, share]) => {
      if (!activeMemberIds.has(memberId) && share.totalAmount > 0) {
        const member = allMembers.find((m) => m.id === memberId);
        otherShares.push({
          name: `${member?.name || "Unknown"} (Đòi riêng ngoài đội)`,
          amount: share.totalAmount,
        });
      }
    });

    const totalDivided = Object.values(calculatedShares).reduce((sum, s) => sum + s.totalAmount, 0);

    return {
      teamShares,
      otherShares,
      totalDivided,
    };
  }, [activeTeams, calculatedShares, allMembers]);

  const handleSaveConfigToDb = async () => {
    setIsSavingConfig(true);
    try {
      const configToSave = {
        expenseItems: expenseItems,
        teamCount,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        sufficientPlayerCount: sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
        paidByMemberId: paidByMemberId || null,
        skipAutoAttendance,
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: getTeamEffectivePercent(t.id),
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
      const totalAmount = expenseItems.reduce((sum, e) => sum + e.amount, 0);
      const matchRef = doc(db, "matches", matchId);
      const matchData: any = {
        date: new Date(`${date}T${time}`),
        totalAmount: totalAmount,
        expenseItems: expenseItems,
        teamCount,
        isTest: isTestMatch,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        sufficientPlayerCount: sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
        paidByMemberId: paidByMemberId || null,
        skipAutoAttendance,
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: getTeamEffectivePercent(t.id),
          members: t.members.map((m) => ({
            id: m.id,
            percent: m.percent === undefined ? null : m.percent,
            reason: m.reason || null,
          })),
        })),
        updatedAt: serverTimestamp(),
      };
      if (!existingStatus || existingStatus === "PENDING") {
        matchData.status = "PENDING";
      } else {
        delete matchData.status;
      }
      await updateDoc(matchRef, matchData);
      toast({
        title: "Đã lưu!",
        description: "Chỉ cập nhật cấu hình/đội hình, chưa tính tiền.",
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
      const totalAmount = expenseItems.reduce((sum, e) => sum + e.amount, 0);
      const matchRef = doc(collection(db, "matches"));
      const matchData = {
        date: new Date(`${date}T${time}`),
        totalAmount: totalAmount,
        expenseItems: expenseItems,
        teamCount,
        status: "PENDING",
        isTest: isTestMatch,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        sufficientPlayerCount: sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
        paidByMemberId: paidByMemberId || null,
        skipAutoAttendance,
        createdAt: serverTimestamp(),
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: getTeamEffectivePercent(t.id),
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
      // Fire push notification cho members
      postApiJson("/notify/attendance-created", { matchId: matchRef.id }).catch(
        (error) =>
          console.error("Failed to send attendance created notification", error)
      );
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
    // Validate từng chi phí
    for (let i = 0; i < expenseItems.length; i++) {
      const expense = expenseItems[i];
      if (!expense.type || expense.type === "SHARED") {
        const sum = activeTeams.reduce((acc, team) => {
          const p = expense.teamPercents?.[team.id] ?? team.percent;
          return acc + p;
        }, 0);
        if (sum !== 100) {
          toast({
            title: `Lỗi phân chia ở Khoản ${i + 1}`,
            description: `Tổng phần trăm các đội cho "${expense.description || "Khoản chi phí"}" phải bằng 100% (hiện tại là ${sum}%)`,
            variant: "destructive",
          });
          return;
        }
      } else if (expense.type === "INDIVIDUAL" && !expense.targetMemberId) {
        toast({
          title: `Lỗi thông tin ở Khoản ${i + 1}`,
          description: `Vui lòng chọn thành viên cần đòi tiền cho "${expense.description || "Khoản chi phí"}"`,
          variant: "destructive",
        });
        return;
      } else if (expense.type === "EQUAL") {
        const totalMembers = activeTeams.reduce((sum, t) => sum + t.members.length, 0);
        if (totalMembers === 0) {
          toast({
            title: `Lỗi phân chia ở Khoản ${i + 1}`,
            description: `Không thể chia đều "${expense.description || "Khoản chi phí"}" vì các đội chưa có thành viên nào`,
            variant: "destructive",
          });
          return;
        }
      }
    }
    const numericTotalAmount = expenseItems.reduce((sum, e) => sum + e.amount, 0);
    if (numericTotalAmount <= 0) {
      toast({
        title: "Lỗi số tiền",
        description: "Vui lòng nhập ít nhất một khoản chi phí có giá trị",
        variant: "destructive",
      });
      return;
    }
    await handleSaveConfigToDb();
    if (activeTeams.some((t) => getTeamEffectivePercent(t.id) > 0 && t.members.length === 0)) {
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

      // Calculate shares per member with expense breakdown
      const memberSharesMap = new Map<string, {
        memberId: string;
        teamId: string;
        totalAmount: number;
        expenseBreakdown: { expenseId: string; description: string; amount: number }[];
        calculationDetails?: object;
      }>();

      expenseItems.forEach((expense) => {
        if (expense.amount <= 0) return;

        if (expense.type === "INDIVIDUAL") {
          if (expense.targetMemberId) {
            let memberTeamId = "pool";
            activeTeams.forEach((t) => {
              if (t.members.some((m) => m.id === expense.targetMemberId)) {
                memberTeamId = t.id;
              }
            });

            if (!memberSharesMap.has(expense.targetMemberId)) {
              memberSharesMap.set(expense.targetMemberId, {
                memberId: expense.targetMemberId,
                teamId: memberTeamId,
                totalAmount: 0,
                expenseBreakdown: [],
                calculationDetails: {
                  isIndividual: true,
                },
              });
            }

            const memberShare = memberSharesMap.get(expense.targetMemberId)!;
            memberShare.totalAmount += expense.amount;
            memberShare.expenseBreakdown.push({
              expenseId: expense.id,
              description: (expense.description || "Đòi riêng") + " (Đòi riêng)",
              amount: expense.amount,
            });
          }
          return;
        }

        if (expense.type === "EQUAL") {
          const eligibleMembers: { member: Member; teamId: string }[] = [];
          activeTeams.forEach((team) => {
            team.members.forEach((m) => {
              if (!m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)) {
                eligibleMembers.push({ member: m, teamId: team.id });
              }
            });
          });

          if (eligibleMembers.length > 0) {
            const amountPerMember = Math.floor(expense.amount / eligibleMembers.length);
            let remainder = expense.amount % eligibleMembers.length;

            eligibleMembers.forEach(({ member, teamId }) => {
              const memberAmount = amountPerMember + (remainder-- > 0 ? 1 : 0);

              if (!memberSharesMap.has(member.id)) {
                memberSharesMap.set(member.id, {
                  memberId: member.id,
                  teamId: teamId,
                  totalAmount: 0,
                  expenseBreakdown: [],
                  calculationDetails: {
                    isEqual: true,
                  },
                });
              }

              const memberShare = memberSharesMap.get(member.id)!;
              memberShare.totalAmount += memberAmount;
              memberShare.expenseBreakdown.push({
                expenseId: expense.id,
                description: expense.description || "Chia đều",
                amount: memberAmount,
              });
            });
          }
          return;
        }

        activeTeams.forEach((team) => {
          if (team.members.length === 0) return;

          const eligibleMembers = team.members.filter(
            (m) => !m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)
          );

          if (eligibleMembers.length === 0) return;

          const teamPercent = expense.teamPercents?.[team.id] ?? team.percent;
          const teamTotal = expense.amount * (teamPercent / 100);

          const fixedPercentMembers = eligibleMembers.filter(
            (m) => m.percent !== undefined && m.percent > 0
          );
          const regularMembers = eligibleMembers.filter(
            (m) => m.percent === undefined || m.percent <= 0
          );

          let totalFixedAmount = 0;

          fixedPercentMembers.forEach((member) => {
            const memberAmount = Math.round(
              teamTotal * ((member.percent || 0) / 100)
            );

            if (!memberSharesMap.has(member.id)) {
              memberSharesMap.set(member.id, {
                memberId: member.id,
                teamId: team.id,
                totalAmount: 0,
                expenseBreakdown: [],
                calculationDetails: {
                  memberPercent: member.percent,
                  reason: member.reason,
                  teamName: team.name,
                  teamTotal: Math.round(teamTotal),
                  totalFixedAmount: 0, // Will be updated after loop
                  remainingAmount: 0, // Will be calculated
                  regularMemberCount: regularMembers.length,
                },
              });
            }

            const memberShare = memberSharesMap.get(member.id)!;
            memberShare.totalAmount += memberAmount;
            memberShare.expenseBreakdown.push({
              expenseId: expense.id,
              description: expense.description,
              amount: memberAmount,
            });

            totalFixedAmount += memberAmount;
          });

          const remainingAmount = teamTotal - totalFixedAmount;

          // Update totalFixedAmount and remainingAmount for fixed percent members
          fixedPercentMembers.forEach((member) => {
            const memberShare = memberSharesMap.get(member.id);
            if (memberShare && memberShare.calculationDetails) {
              memberShare.calculationDetails.totalFixedAmount = Math.round(totalFixedAmount);
              memberShare.calculationDetails.remainingAmount = Math.round(remainingAmount);
            }
          });

          if (regularMembers.length > 0 && remainingAmount >= 0) {
            const amountPerRegular = Math.floor(
              remainingAmount / regularMembers.length
            );
            let remainder = remainingAmount % regularMembers.length;
            regularMembers.forEach((member) => {
              const memberAmount = amountPerRegular + (remainder-- > 0 ? 1 : 0);

              if (!memberSharesMap.has(member.id)) {
                memberSharesMap.set(member.id, {
                  memberId: member.id,
                  teamId: team.id,
                  totalAmount: 0,
                  expenseBreakdown: [],
                  calculationDetails: {
                    teamName: team.name,
                    teamTotal: Math.round(teamTotal),
                    totalFixedAmount: Math.round(totalFixedAmount),
                    remainingAmount: Math.round(remainingAmount),
                    regularMemberCount: regularMembers.length,
                  },
                });
              }

              const memberShare = memberSharesMap.get(member.id)!;
              memberShare.totalAmount += memberAmount;
              memberShare.expenseBreakdown.push({
                expenseId: expense.id,
                description: expense.description,
                amount: memberAmount,
              });
            });
          }
        });
      });

      // Convert map to shares array
      memberSharesMap.forEach((memberShare) => {
        shares.push({
          matchId: matchRef.id,
          memberId: memberShare.memberId,
          teamId: memberShare.teamId,
          amount: memberShare.totalAmount,
          status: "PENDING",
          orderCode: "",
          expenseBreakdown: memberShare.expenseBreakdown,
          calculationDetails: memberShare.calculationDetails,
        });
      });

      // Recalculate total and adjust for rounding errors
      const calculatedTotal = shares.reduce((sum, s) => sum + s.amount, 0);
      const diff = numericTotalAmount - calculatedTotal;
      if (diff !== 0 && shares.length > 0) {
        shares[shares.length - 1].amount += diff;
      }

      const batch = writeBatch(db);

      const matchData = {
        date: new Date(`${date}T${time}`),
        totalAmount: numericTotalAmount,
        expenseItems: expenseItems,
        teamCount,
        isTest: isTestMatch,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        sufficientPlayerCount: sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
        paidByMemberId: paidByMemberId || null,
        skipAutoAttendance,
        teamsConfig: activeTeams.map((t) => ({
          id: t.id,
          name: t.name,
          percent: getTeamEffectivePercent(t.id),
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
      setExistingStatus("COMPLETED");
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
          <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
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
              <Label htmlFor="time">Giờ đá</Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
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
              <Label htmlFor="is-test-match">Trận test</Label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  id="is-test-match"
                  checked={isTestMatch}
                  onCheckedChange={setIsTestMatch}
                />
                <span className="text-sm text-muted-foreground">
                  Luôn hiện nút xóa
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="skip-auto-attend">Bỏ tự động điểm danh</Label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  id="skip-auto-attend"
                  checked={skipAutoAttendance}
                  onCheckedChange={setSkipAutoAttendance}
                />
                <span className="text-sm text-muted-foreground">
                  Mọi người tự điểm danh
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 shadow-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Chi phí trận đấu</CardTitle>
                <CardDescription>
                  Thêm các khoản chi phí (tiền sân, tiền nước, v.v.), cấu hình tỷ lệ chia cho từng mục hoặc đòi tiền riêng.
                </CardDescription>
              </div>
              <Button onClick={handleAddExpense} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Thêm chi phí
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {expenseItems.map((expense, index) => (
              <div key={expense.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm">Khoản {index + 1}</h4>
                  {expenseItems.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveExpense(expense.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`expense-desc-${expense.id}`}>Mô tả</Label>
                    <Input
                      id={`expense-desc-${expense.id}`}
                      placeholder="Tiền sân, Tiền nước, ..."
                      value={expense.description}
                      onChange={(e) =>
                        handleUpdateExpense(expense.id, "description", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`expense-amount-${expense.id}`}>Số tiền (VND)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id={`expense-amount-${expense.id}`}
                        type="number"
                        placeholder="500000"
                        value={expense.amount || ""}
                        onChange={(e) =>
                          handleUpdateExpense(
                            expense.id,
                            "amount",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="pl-10"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 py-1 flex-wrap">
                  <span className="text-sm font-medium">Hình thức chia:</span>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      type="button"
                      variant={(!expense.type || expense.type === "SHARED") ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleUpdateExpense(expense.id, "type", "SHARED")}
                    >
                      Chia theo đội
                    </Button>
                    <Button
                      type="button"
                      variant={expense.type === "EQUAL" ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleUpdateExpense(expense.id, "type", "EQUAL")}
                    >
                      Chia đều tất cả
                    </Button>
                    <Button
                      type="button"
                      variant={expense.type === "INDIVIDUAL" ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleUpdateExpense(expense.id, "type", "INDIVIDUAL")}
                    >
                      Đòi riêng member
                    </Button>
                  </div>
                </div>

                {(!expense.type || expense.type === "SHARED") && (
                  <div className="space-y-3 pt-2">
                    <Label>Tỷ lệ chia giữa các đội (%)</Label>
                    <div className="flex flex-wrap gap-4 items-center">
                      {activeTeams.map((team) => {
                        const currentPercent = expense.teamPercents?.[team.id] ?? (teams.find(t => t.id === team.id)?.percent ?? 0);
                        return (
                          <div key={team.id} className="flex items-center gap-2">
                            <span className="text-xs font-semibold">{team.name}:</span>
                            <div className="relative w-20">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={currentPercent}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0;
                                  const updatedPercents = {
                                    ...(expense.teamPercents || {}),
                                    [team.id]: val
                                  };
                                  activeTeams.forEach(t => {
                                    if (updatedPercents[t.id] === undefined) {
                                      updatedPercents[t.id] = t.percent;
                                    }
                                  });
                                  handleUpdateExpense(expense.id, "teamPercents", updatedPercents);
                                }}
                                className="pr-5 h-8 text-xs"
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                            </div>
                          </div>
                        );
                      })}
                      {(() => {
                        const sum = activeTeams.reduce((acc, team) => {
                          const p = expense.teamPercents?.[team.id] ?? (teams.find(t => t.id === team.id)?.percent ?? 0);
                          return acc + p;
                        }, 0);
                        return (
                          <Badge variant={sum === 100 ? "outline" : "destructive"} className="text-xs">
                            Tổng: {sum}%
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {(!expense.type || expense.type === "SHARED" || expense.type === "EQUAL") && (
                  <div className="space-y-2 pt-2">
                    <Label>Miễn chia (chọn members không phải trả khoản này)</Label>
                    <Popover
                      open={activePopoverId === `exempt-${expense.id}`}
                      onOpenChange={(open) =>
                        setActivePopoverId(open ? `exempt-${expense.id}` : null)
                      }
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={activePopoverId === `exempt-${expense.id}`}
                          className="w-full justify-between font-normal"
                        >
                          Chọn member để miễn chia...
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Tìm thành viên..." />
                          <CommandList>
                            <CommandEmpty>Không tìm thấy thành viên.</CommandEmpty>
                            <CommandGroup>
                              {allMembers
                                .filter((m) => !expense.exemptMemberIds.includes(m.id))
                                .map((m) => (
                                  <CommandItem
                                    key={m.id}
                                    value={`${m.name} ${m.nickname || ""}`}
                                    onSelect={() => {
                                      handleUpdateExpense(expense.id, "exemptMemberIds", [
                                        ...expense.exemptMemberIds,
                                        m.id,
                                      ]);
                                      setActivePopoverId(null);
                                    }}
                                  >
                                    <Check className="mr-2 h-4 w-4 opacity-0" />
                                    {m.name}
                                    {m.nickname ? ` (${m.nickname})` : ""}
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {expense.exemptMemberIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {expense.exemptMemberIds.map((memberId) => {
                          const member = allMembers.find((m) => m.id === memberId);
                          return (
                            <Badge
                              key={memberId}
                              variant="secondary"
                              className="flex items-center gap-1"
                            >
                              {member?.name || "Unknown"}
                              <X
                                className="h-3 w-3 cursor-pointer"
                                onClick={() =>
                                  handleUpdateExpense(
                                    expense.id,
                                    "exemptMemberIds",
                                    expense.exemptMemberIds.filter((id) => id !== memberId)
                                  )
                                }
                              />
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {expense.type === "INDIVIDUAL" && (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor={`expense-target-${expense.id}`}>Chọn thành viên cần đòi tiền</Label>
                    <Popover
                      open={activePopoverId === `target-${expense.id}`}
                      onOpenChange={(open) =>
                        setActivePopoverId(open ? `target-${expense.id}` : null)
                      }
                    >
                      <PopoverTrigger asChild>
                        <Button
                          id={`expense-target-${expense.id}`}
                          variant="outline"
                          role="combobox"
                          aria-expanded={activePopoverId === `target-${expense.id}`}
                          className="w-full justify-between font-normal"
                        >
                          {expense.targetMemberId
                            ? (() => {
                                const m = allMembers.find((member) => member.id === expense.targetMemberId);
                                return m ? `${m.name}${m.nickname ? ` (${m.nickname})` : ""}` : "Chọn thành viên...";
                              })()
                            : "Chọn thành viên..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Tìm thành viên..." />
                          <CommandList>
                            <CommandEmpty>Không tìm thấy thành viên.</CommandEmpty>
                            <CommandGroup>
                              {allMembers.map((m) => (
                                <CommandItem
                                  key={m.id}
                                  value={`${m.name} ${m.nickname || ""}`}
                                  onSelect={() => {
                                    handleUpdateExpense(expense.id, "targetMemberId", m.id);
                                    setActivePopoverId(null);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      expense.targetMemberId === m.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {m.name}
                                  {m.nickname ? ` (${m.nickname})` : ""}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>
            ))}
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between text-lg font-semibold">
                <span>Tổng cộng:</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-primary cursor-help border-b border-dashed border-primary">
                        {expenseItems.reduce((sum, e) => sum + e.amount, 0).toLocaleString()} VND
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="p-3 max-w-[280px]">
                      <div className="space-y-2 text-xs">
                        <p className="font-bold border-b pb-1">Chi tiết phân chia:</p>
                        {matchDivisionDetails.teamShares.map((ts, idx) => (
                          <div key={idx} className="flex justify-between gap-4">
                            <span>{ts.name}:</span>
                            <span className="font-semibold">{Math.round(ts.amount).toLocaleString()}đ</span>
                          </div>
                        ))}
                        {matchDivisionDetails.otherShares.map((os, idx) => (
                          <div key={idx} className="flex justify-between gap-4 text-destructive">
                            <span>{os.name}:</span>
                            <span className="font-semibold">{Math.round(os.amount).toLocaleString()}đ</span>
                          </div>
                        ))}
                        <div className="border-t pt-1 mt-1 flex justify-between font-bold text-primary">
                          <span>Tổng đã chia:</span>
                          <span>{Math.round(matchDivisionDetails.totalDivided).toLocaleString()}đ</span>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Địa điểm & Cấu hình điểm danh
            </CardTitle>
            <CardDescription>
              Lưu vào Cấu Hình để dùng làm mặc định cho các trận tiếp theo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="venue-name">Tên sân</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="venue-name"
                    placeholder="Sân bóng Phú Thọ"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="close-hours" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Đóng điểm danh trước ngày đá (giờ)
                </Label>
                <Input
                  id="close-hours"
                  type="number"
                  min="1"
                  max="72"
                  value={attendanceCloseHours}
                  onChange={(e) =>
                    setAttendanceCloseHours(parseInt(e.target.value) || 12)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Mặc định: 12 giờ (đóng lúc 12:00 ngày hôm trước)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sufficient-player-count" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Số người tối thiểu để dừng nhắc nhở
                </Label>
                <Input
                  id="sufficient-player-count"
                  type="number"
                  min="0"
                  value={sufficientPlayerCount}
                  onChange={(e) =>
                    setSufficientPlayerCount(e.target.value === "" ? "" : (parseInt(e.target.value) || 0))
                  }
                  placeholder="Mặc định: 14"
                />
                <p className="text-xs text-muted-foreground">
                  Nếu đủ số người này điểm danh, các nhắc nhở điểm danh sẽ tự động tắt.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paid-by" className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Người ứng tiền sân
                </Label>
                <Popover open={paidByPopoverOpen} onOpenChange={setPaidByPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="paid-by"
                      variant="outline"
                      role="combobox"
                      aria-expanded={paidByPopoverOpen}
                      className="w-full justify-between font-normal"
                    >
                      {paidByMemberId
                        ? (() => {
                            const m = allMembers.find((member) => member.id === paidByMemberId);
                            return m ? `${m.name}${m.nickname ? ` (${m.nickname})` : ""}` : "Chọn người ứng tiền...";
                          })()
                        : "Chọn người ứng tiền (tùy chọn)"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Tìm thành viên..." />
                      <CommandList>
                        <CommandEmpty>Không tìm thấy thành viên.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__none__"
                            onSelect={() => {
                              setPaidByMemberId("");
                              setPaidByPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                !paidByMemberId ? "opacity-100" : "opacity-0"
                              )}
                            />
                            — Không có —
                          </CommandItem>
                          {allMembers.map((m) => (
                            <CommandItem
                              key={m.id}
                              value={`${m.name} ${m.nickname || ""}`}
                              onSelect={() => {
                                setPaidByMemberId(m.id);
                                setPaidByPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  paidByMemberId === m.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {m.name}
                              {m.nickname ? ` (${m.nickname})` : ""}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  Người này sẽ được hiển thị trên Slack & trang chi tiết để mọi
                  người chuyển tiền lại.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="map-iframe">
                Google Maps iframe
              </Label>
              <Textarea
                id="map-iframe"
                placeholder='Paste iframe từ Google Maps vào đây&#10;<iframe src="https://www.google.com/maps/embed?..." ...></iframe>'
                value={mapIframe}
                onChange={(e) => setMapIframe(e.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Google Maps → Chia sẻ → Nhúng bản đồ → Copy HTML
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Tên các đội
            </CardTitle>
            <CardDescription>
              Điều chỉnh tên hiển thị cho mỗi đội.
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
                <CardDescription className="space-y-2">
                  {(() => {
                    const teamTotalAmount = team.members.reduce(
                      (sum, m) => sum + (calculatedShares[m.id]?.totalAmount || 0),
                      0
                    );

                    // Gom các chi tiết khoản tiền của các thành viên trong đội dựa trên cấu hình chi phí và đính kèm %
                    const teamDetails: { description: string; amount: number }[] = [];
                    
                    expenseItems.forEach((expense) => {
                      if (expense.amount <= 0) return;

                      if (expense.type === "INDIVIDUAL") {
                        const teamIndividualAmount = team.members.reduce((sum, m) => {
                          if (expense.targetMemberId === m.id) {
                            return sum + expense.amount;
                          }
                          return sum;
                        }, 0);
                        if (teamIndividualAmount > 0) {
                          teamDetails.push({
                            description: `${expense.description || "Đòi riêng"} (Đòi riêng cá nhân)`,
                            amount: teamIndividualAmount,
                          });
                        }
                        return;
                      }

                      if (expense.type === "EQUAL") {
                        const eligibleMembersCount = activeTeams.reduce((sum, t) => {
                          return sum + t.members.filter(
                            (m) => !m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)
                          ).length;
                        }, 0);

                        if (eligibleMembersCount > 0) {
                          const amountPerMember = Math.floor(expense.amount / eligibleMembersCount);
                          let remainder = expense.amount % eligibleMembersCount;
                          
                          let teamEqualAmount = 0;
                          
                          const allEligibleMembers: string[] = [];
                          activeTeams.forEach((t) => {
                            t.members.forEach((m) => {
                              if (!m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)) {
                                allEligibleMembers.push(m.id);
                              }
                            });
                          });

                          team.members.forEach((m) => {
                            if (!m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)) {
                              const idx = allEligibleMembers.indexOf(m.id);
                              const memberAmount = amountPerMember + (idx < remainder ? 1 : 0);
                              teamEqualAmount += memberAmount;
                            }
                          });

                          if (teamEqualAmount > 0) {
                            teamDetails.push({
                              description: `${expense.description || "Chia đều"} (Chia đều)`,
                              amount: teamEqualAmount,
                            });
                          }
                        }
                        return;
                      }

                      // SHARED / default
                      const teamPercent = expense.teamPercents?.[team.id] ?? (teams.find(t => t.id === team.id)?.percent ?? 0);
                      const teamTotal = expense.amount * (teamPercent / 100);
                      
                      let teamSharedAmount = 0;
                      const eligibleMembers = team.members.filter(
                        (m) => !m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id)
                      );
                      
                      if (eligibleMembers.length > 0) {
                        const fixedPercentMembers = eligibleMembers.filter(
                          (m) => m.percent !== undefined && m.percent > 0
                        );
                        const regularMembers = eligibleMembers.filter(
                          (m) => m.percent === undefined || m.percent <= 0
                        );

                        let totalFixedAmount = 0;
                        fixedPercentMembers.forEach((member) => {
                          const memberAmount = Math.round(
                            teamTotal * ((member.percent || 0) / 100)
                          );
                          teamSharedAmount += memberAmount;
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
                            teamSharedAmount += memberAmount;
                          });
                        }
                      }

                      if (teamSharedAmount > 0) {
                        teamDetails.push({
                          description: `${expense.description || "Tiền sân"} (${teamPercent}%)`,
                          amount: teamSharedAmount,
                        });
                      }
                    });

                    return (
                      <>
                        <div className="flex justify-between items-center text-sm font-semibold">
                          <span>Tổng tiền đội:</span>
                          <span className="text-primary font-bold">
                            {teamTotalAmount.toLocaleString()} VND
                          </span>
                        </div>
                        {teamDetails.length > 0 && (
                          <div className="text-xs text-muted-foreground border-t pt-1.5 space-y-1">
                            {teamDetails.map((detail, idx) => (
                              <div key={idx} className="flex justify-between">
                                <span>{detail.description}:</span>
                                <span>{Math.round(detail.amount).toLocaleString()}đ</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
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
                        {calculatedShares[member.id] ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-primary">
                                  {Math.round(
                                    calculatedShares[member.id].totalAmount
                                  ).toLocaleString()}đ
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1 text-xs">
                                  <p className="font-bold border-b pb-1">Chi tiết tiền:</p>
                                  {calculatedShares[member.id].details.map((detail, idx) => (
                                    <div key={idx} className="flex justify-between gap-4">
                                      <span>{detail.description}:</span>
                                      <span className="font-semibold">{Math.round(detail.amount).toLocaleString()}đ</span>
                                    </div>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          "0đ"
                        )}
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
                Cập nhật (không tính tiền)
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
