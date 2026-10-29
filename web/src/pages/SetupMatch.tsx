import { DEFAULT_GROUP_ID, groupIdOf, settingsDocPath } from "@/lib/groups";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  BookmarkPlus,
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
  Sparkles,
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
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { postApiJson, apiRequest } from "@/lib/api";
import { MatchScheduleModal } from "@/components/matches/MatchScheduleModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn, createMatchDate, getMatchDateTimeInput } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { balanceTeamsByElo } from "@/lib/elo";

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
  elo?: number;
  eloTier?: string;
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
  type?: "SHARED" | "INDIVIDUAL" | "EQUAL" | "SUBSIDY";
  targetMemberId?: string;
  note?: string;
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
  teamCount: 1 | 2 | 3;
  teamsConfig: SavedTeamConfig[];
  date?: Timestamp;
  kickoffTime?: string;
  status?: "PENDING" | "COMPLETED" | "PUBLISHED";
  isTest?: boolean;
  venueName?: string;
  mapIframe?: string;
  attendanceCloseHours?: number;
  attendanceReminderOnly?: boolean;
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

/**
 * Helper to get participation weight of a member.
 * Default is 1.0 (1 full share / 100%).
 * If percent is defined and > 0, weight is percent / 100 (e.g. 50% -> 0.5 share).
 */
export const getMemberWeight = (member: { percent?: number }): number => {
  if (
    member.percent === undefined ||
    member.percent === null ||
    member.percent <= 0
  ) {
    return 1;
  }
  return member.percent / 100;
};

/**
 * Distribute an amount proportionally according to member weights,
 * with exact integer rounding and remainder reconciliation so sum === totalAmount.
 */
export const distributeAmountByWeights = <
  T extends { id: string; percent?: number },
>(
  members: T[],
  totalAmount: number,
): Map<string, number> => {
  const result = new Map<string, number>();
  if (members.length === 0 || totalAmount <= 0) {
    members.forEach((m) => result.set(m.id, 0));
    return result;
  }

  const weights = members.map((m) => getMemberWeight(m));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  if (totalWeight <= 0) {
    members.forEach((m) => result.set(m.id, 0));
    return result;
  }

  let distributed = 0;
  members.forEach((m, idx) => {
    const w = weights[idx];
    const share = Math.round((w / totalWeight) * totalAmount);
    result.set(m.id, share);
    distributed += share;
  });

  // Reconcile rounding difference to the last member so sum === totalAmount exactly
  const diff = Math.round(totalAmount) - distributed;
  if (diff !== 0 && members.length > 0) {
    const adjustMember = members[members.length - 1];
    const currentVal = result.get(adjustMember.id) || 0;
    result.set(adjustMember.id, Math.max(0, currentVal + diff));
  }

  return result;
};

const sanitizeExpenseItems = (items: ExpenseItem[]) => {
  return items.map((exp) => {
    const item: Record<string, any> = {
      id: exp.id,
      description: exp.description || "",
      amount: exp.amount || 0,
      exemptMemberIds: exp.exemptMemberIds || [],
      type: exp.type || "SHARED",
    };
    if (exp.teamPercents) item.teamPercents = exp.teamPercents;
    if (exp.targetMemberId) item.targetMemberId = exp.targetMemberId;
    if (exp.note) item.note = exp.note;
    return item;
  });
};

const SetupMatch = () => {
  const { groupId, group, loading: groupLoading } = useGroup();
  const usesTeams = group?.sport !== "badminton";
  const groupPath = useGroupPath();
  const { matchId } = useParams();
  const navigate = useNavigate();

  const todayLocalKey = getMatchDateTimeInput(new Date()).date;
  const [date, setDate] = useState(todayLocalKey);
  const [time, setTime] = useState("19:00");
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([
    {
      id: "default",
      description: "Tiền sân",
      amount: 0,
      exemptMemberIds: [],
      teamPercents: { A: usesTeams ? 50 : 100, B: usesTeams ? 50 : 0, C: 0 },
      type: usesTeams ? "SHARED" : "EQUAL",
    },
  ]);
  const [teamCount, setTeamCount] = useState<2 | 3>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingWithAttendance, setIsCreatingWithAttendance] =
    useState(false);
  const [isCreatingWithoutAttendance, setIsCreatingWithoutAttendance] =
    useState(false);
  const [hasPaidShares, setHasPaidShares] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const isBusy =
    groupLoading ||
    isLoading ||
    isSaving ||
    isSavingConfig ||
    isUpdatingConfig ||
    isCreatingWithAttendance ||
    isCreatingWithoutAttendance;
  const [existingStatus, setExistingStatus] = useState<
    "PENDING" | "COMPLETED" | "PUBLISHED" | undefined
  >("PENDING");
  const [wasPublished, setWasPublished] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isTestMatch, setIsTestMatch] = useState(false);
  const [skipAutoAttendance, setSkipAutoAttendance] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [mapIframe, setMapIframe] = useState("");
  const [attendanceCloseHours, setAttendanceCloseHours] = useState(12);
  const [attendanceReminderOnly, setAttendanceReminderOnly] = useState(false);
  const [sufficientPlayerCount, setSufficientPlayerCount] = useState<
    number | ""
  >(usesTeams ? 14 : "");
  const [paidByMemberId, setPaidByMemberId] = useState<string>("");
  const [paidByPopoverOpen, setPaidByPopoverOpen] = useState(false);
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [pool, setPool] = useState<Member[]>([]);
  const [attendance, setAttendance] = useState<Set<string>>(new Set());
  const [customPercentMemberIds, setCustomPercentMemberIds] = useState<
    Set<string>
  >(new Set());
  const [teams, setTeams] = useState<Team[]>([
    {
      id: "A",
      name: usesTeams ? "Đội A" : "Người tham gia",
      color: "bg-blue-500",
      members: [],
      percent: usesTeams ? 50 : 100,
    },
    { id: "B", name: "Đội B", color: "bg-red-500", members: [], percent: 50 },
    { id: "C", name: "Đội C", color: "bg-yellow-500", members: [], percent: 0 },
  ]);

  const activeTeams = teams.slice(0, usesTeams ? teamCount : 1);
  const totalPercent = activeTeams.reduce((sum, t) => sum + t.percent, 0);

  const getTeamEffectivePercent = (teamId: string) => {
    if (!usesTeams) return teamId === "A" ? 100 : 0;
    const totalExpenseAmount = expenseItems
      .filter((e) => e.type !== "SUBSIDY")
      .reduce((sum, e) => sum + e.amount, 0);
    if (totalExpenseAmount <= 0) return teamId === "C" ? 0 : 50;

    const teamTotalAmount = expenseItems.reduce((sum, expense) => {
      if (expense.amount <= 0) return sum;
      if (expense.type === "INDIVIDUAL" || expense.type === "SUBSIDY") return sum;
      const teamPercent =
        expense.teamPercents?.[teamId] ??
        teams.find((t) => t.id === teamId)?.percent ??
        0;
      return sum + (expense.amount * teamPercent) / 100;
    }, 0);

    return Math.round((teamTotalAmount / totalExpenseAmount) * 100);
  };

  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [isDefaultTemplate, setIsDefaultTemplate] = useState(false);
  const [templateScheduleEnabled, setTemplateScheduleEnabled] = useState(false);
  const [templateScheduleDay, setTemplateScheduleDay] = useState(2);
  const [templateScheduleHour, setTemplateScheduleHour] = useState(9);
  const [templateMatchDay, setTemplateMatchDay] = useState(4);
  const [templateMatchTime, setTemplateMatchTime] = useState("19:00");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isUpdatingTemplate, setIsUpdatingTemplate] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);

  const applyTemplate = useCallback((tpl: any) => {
    setSelectedTemplateId(tpl.id);
    if (tpl.venueName !== undefined) setVenueName(tpl.venueName || "");
    if (tpl.mapIframe !== undefined) setMapIframe(tpl.mapIframe || "");
    if (tpl.attendanceCloseHours !== undefined)
      setAttendanceCloseHours(tpl.attendanceCloseHours);
    if (tpl.attendanceReminderOnly !== undefined)
      setAttendanceReminderOnly(Boolean(tpl.attendanceReminderOnly));
    else
      setAttendanceReminderOnly(false);
    if (tpl.sufficientPlayerCount !== undefined)
      setSufficientPlayerCount(
        tpl.sufficientPlayerCount ?? (usesTeams ? 14 : ""),
      );
    if (tpl.paidByMemberId !== undefined)
      setPaidByMemberId(tpl.paidByMemberId || "");
    if (tpl.kickoffTime) setTime(tpl.kickoffTime);
    if (tpl.teamCount && usesTeams) setTeamCount(tpl.teamCount);
    if (Array.isArray(tpl.expenseItems) && tpl.expenseItems.length > 0) {
      setExpenseItems(tpl.expenseItems);
    }
    toast({
      title: "Đã áp dụng mẫu",
      description: `Đã điền thông tin từ mẫu "${tpl.name}".`,
    });
  }, [usesTeams]);

  const loadTemplates = useCallback(async () => {
    try {
      if (typeof apiRequest !== "function") return;
      const data = await apiRequest("GET", `/groups/${groupId}/templates`);
      if (Array.isArray(data)) {
        setTemplates(data);
        if (!matchId && !selectedTemplateId) {
          const defaultTpl = data.find((t: any) => t.isDefault);
          if (defaultTpl) {
            applyTemplate(defaultTpl);
          }
        }
      }
    } catch (e) {
      console.error("Failed to load templates", e);
    }
  }, [groupId, matchId, selectedTemplateId, applyTemplate]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleSaveAsTemplate = async () => {
    if (!newTemplateName.trim()) return;
    setIsSavingTemplate(true);
    try {
      const totalAmount = expenseItems
        .filter((e) => e.type !== "SUBSIDY")
        .reduce((sum, e) => sum + e.amount, 0);
      const payload = {
        name: newTemplateName.trim(),
        isDefault: isDefaultTemplate,
        venueName: venueName || "",
        totalAmount,
        mapIframe: mapIframe || "",
        attendanceCloseHours,
        attendanceReminderOnly,
        sufficientPlayerCount:
          sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
        paidByMemberId: paidByMemberId || null,
        kickoffTime: time,
        teamCount: usesTeams ? teamCount : 1,
        expenseItems,
        schedule: templateScheduleEnabled
          ? {
              enabled: true,
              dayOfWeek: templateScheduleDay,
              createHour: templateScheduleHour,
              matchDayOfWeek: templateMatchDay,
              matchTime: templateMatchTime,
            }
          : null,
      };
      const res = await apiRequest(
        "POST",
        `/groups/${groupId}/templates`,
        payload,
      );
      toast({ title: "Đã lưu mẫu trận đấu thành công" });
      setIsSaveTemplateOpen(false);
      setNewTemplateName("");
      setIsDefaultTemplate(false);
      setTemplateScheduleEnabled(false);
      await loadTemplates();
      if (res?.id) setSelectedTemplateId(res.id);
    } catch {
      toast({ variant: "destructive", title: "Không thể lưu mẫu trận đấu" });
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleUpdateCurrentTemplate = async () => {
    if (!selectedTemplateId || !groupId) return;
    const curTemplate = templates.find((t) => t.id === selectedTemplateId);
    if (!curTemplate) return;

    setIsUpdatingTemplate(true);
    try {
      const numericTotal = expenseItems
        .filter((e) => e.type !== "SUBSIDY")
        .reduce((sum, e) => sum + e.amount, 0);

      const payload = {
        id: selectedTemplateId,
        name: curTemplate.name,
        isDefault: Boolean(curTemplate.isDefault),
        venueName: venueName || "",
        totalAmount: numericTotal,
        mapIframe: mapIframe || "",
        attendanceCloseHours,
        attendanceReminderOnly,
        sufficientPlayerCount:
          sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
        paidByMemberId: paidByMemberId || null,
        kickoffTime: time,
        teamCount: usesTeams ? teamCount : 1,
        expenseItems: sanitizeExpenseItems(expenseItems),
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
        schedule: curTemplate.schedule || null,
      };

      await apiRequest("POST", `/groups/${groupId}/templates`, payload);
      toast({
        title: "Đã cập nhật mẫu!",
        description: `Đã lưu các thiết lập hiện tại vào mẫu "${curTemplate.name}".`,
      });
      await loadTemplates();
    } catch (err: any) {
      console.error("Failed to update template:", err);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: err?.message || "Không thể cập nhật mẫu trận đấu.",
      });
    } finally {
      setIsUpdatingTemplate(false);
    }
  };

  const handleSetTemplateAsDefault = async (tpl: any) => {
    try {
      await apiRequest("POST", `/groups/${groupId}/templates`, {
        ...tpl,
        isDefault: true,
      });
      toast({ title: `Đã đặt "${tpl.name}" làm mẫu mặc định của nhóm` });
      await loadTemplates();
    } catch {
      toast({ variant: "destructive", title: "Không thể cập nhật mẫu mặc định" });
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await apiRequest("DELETE", `/groups/${groupId}/templates/${templateId}`);
      toast({ title: "Đã xóa mẫu trận đấu" });
      setSelectedTemplateId("");
      await loadTemplates();
    } catch {
      toast({ variant: "destructive", title: "Không thể xóa mẫu" });
    }
  };

  const fetchData = useCallback(async () => {
    if (groupLoading) return;
    setIsLoading(true);
    try {
      const membersCollectionRef = collection(db, "members");
      const membersSnapshot = await getDocs(
        query(membersCollectionRef, where("groupId", "==", groupId)),
      );
      const membersList = membersSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as Member)
        .filter((m) => !m.inactive);
      const membersMap = new Map(membersList.map((m) => [m.id, m]));
      setAllMembers(membersList);

      let configSource: MatchConfig | null = null;

      if (matchId) {
        const matchRef = doc(db, "matches", matchId);
        const matchSnap = await getDoc(matchRef);
        if (matchSnap.exists() && groupIdOf(matchSnap.data()) === groupId) {
          configSource = matchSnap.data() as MatchConfig;
          if ((configSource as any).status) {
            setExistingStatus((configSource as any).status);
          }
          setWasPublished(
            Boolean(
              (configSource as any).wasPublished ||
              (configSource as any).publishedAt ||
              (configSource as any).status === "PUBLISHED",
            ),
          );
          const attendanceCollectionRef = collection(
            db,
            "matches",
            matchId,
            "attendance",
          );
          const attendanceSnapshot = await getDocs(attendanceCollectionRef);
          const attendanceSet = new Set<string>();
          attendanceSnapshot.forEach((doc) => attendanceSet.add(doc.id));
          setAttendance(attendanceSet);

          const sharesCollectionRef = collection(
            db,
            "matches",
            matchId,
            "shares",
          );
          const sharesSnapshot = await getDocs(sharesCollectionRef);
          setHasPaidShares(
            sharesSnapshot.docs.some((doc) => doc.data().status === "PAID"),
          );
        } else {
          toast({
            variant: "destructive",
            title: "Lỗi",
            description: "Match not found",
          });
          navigate(groupPath("admin/setup"));
          return;
        }
      } else {
        setHasPaidShares(false);
        const configRef = doc(db, ...settingsDocPath(groupId, "lastMatch"));
        let configSnap = await getDoc(configRef);
        if (!configSnap.exists() && groupId === DEFAULT_GROUP_ID) {
          configSnap = await getDoc(doc(db, "configs", "last_match"));
        }
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

        let newTeams = defaultTeams.map((originalTeam) => {
          const savedTeam = savedConfig.teamsConfig.find(
            (st) => st.id === originalTeam.id,
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
                      percent:
                        typeof savedMember.percent === "number" &&
                        savedMember.percent > 0 &&
                        savedMember.percent !== 100
                          ? savedMember.percent
                          : undefined,
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

        if (!usesTeams) {
          const participants = new Map(
            newTeams
              .flatMap((team) => team.members)
              .map((member) => [member.id, member]),
          );
          newTeams = newTeams.map((team) => ({
            ...team,
            name: team.id === "A" ? "Người tham gia" : team.name,
            percent: team.id === "A" ? 100 : 0,
            members: team.id === "A" ? [...participants.values()] : [],
          }));
        }

        const membersInNewTeams = new Set(
          newTeams.flatMap((t) => t.members.map((m) => m.id)),
        );
        const newPool = membersList.filter((m) => !membersInNewTeams.has(m.id));

        const initialTeamPercents = savedConfig.teamsConfig?.reduce(
          (acc, team) => {
            acc[team.id] = team.percent;
            return acc;
          },
          {} as { [teamId: string]: number },
        ) || { A: 50, B: 50, C: 0 };

        // Backward compatibility: convert old totalAmount to expenseItems
        if (savedConfig.expenseItems && savedConfig.expenseItems.length > 0) {
          setExpenseItems(
            savedConfig.expenseItems.map((item) => ({
              ...item,
              type: usesTeams
                ? item.type || "SHARED"
                : item.type === "INDIVIDUAL"
                  ? "INDIVIDUAL"
                  : item.type === "SUBSIDY"
                    ? "SUBSIDY"
                    : "EQUAL",
              teamPercents: item.teamPercents || { ...initialTeamPercents },
            })),
          );
        } else if (savedConfig.totalAmount) {
          // Old format: convert totalAmount to single expense item
          setExpenseItems([
            {
              id: "default",
              description: "Tiền sân",
              amount: parseFloat(savedConfig.totalAmount.toString()) || 0,
              exemptMemberIds: [],
              type: usesTeams ? "SHARED" : "EQUAL",
              teamPercents: { ...initialTeamPercents },
            },
          ]);
        } else {
          setExpenseItems([
            {
              id: "default",
              description: "Tiền sân",
              amount: 0,
              exemptMemberIds: [],
              type: usesTeams ? "SHARED" : "EQUAL",
              teamPercents: { ...initialTeamPercents },
            },
          ]);
        }

        setTeamCount(savedConfig.teamCount === 3 ? 3 : 2);
        setIsTestMatch(savedConfig.isTest || false);
        setVenueName(savedConfig.venueName || "");
        setMapIframe(savedConfig.mapIframe || "");
        setAttendanceCloseHours(savedConfig.attendanceCloseHours ?? 12);
        setAttendanceReminderOnly(Boolean(savedConfig.attendanceReminderOnly));
        setSufficientPlayerCount(
          savedConfig.sufficientPlayerCount ?? (usesTeams ? 14 : ""),
        );
        setPaidByMemberId(savedConfig.paidByMemberId || "");
        setSkipAutoAttendance(savedConfig.skipAutoAttendance || false);
        setTeams(newTeams);
        setPool(newPool);
        if (matchId && configSource.date) {
          const kickoff = getMatchDateTimeInput(configSource.date.toDate());
          setDate(kickoff.date);
          setTime(kickoff.time);
        } else if (!matchId && configSource.kickoffTime) {
          setTime(configSource.kickoffTime);
        }
      } else {
        setPool(membersList);
        if (!usesTeams) {
          setTeams((current) =>
            current.map((team) => ({
              ...team,
              name: team.id === "A" ? "Người tham gia" : team.name,
              percent: team.id === "A" ? 100 : 0,
              members: [],
            })),
          );
          setExpenseItems([
            {
              id: "default",
              description: "Tiền sân",
              amount: 0,
              exemptMemberIds: [],
              type: "EQUAL",
              teamPercents: { A: 100, B: 0, C: 0 },
            },
          ]);
        }
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
  }, [matchId, navigate, groupPath, groupId, usesTeams, groupLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDragStart = (
    e: React.DragEvent,
    member: Member,
    source: string,
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
        : t,
    );

    if (targetTeamId === "pool") {
      nextPool = [...nextPool, member];
    } else {
      nextTeams = nextTeams.map((t) =>
        t.id === targetTeamId ? { ...t, members: [...t.members, member] } : t,
      );
    }

    setPool(nextPool);
    setTeams(nextTeams);
  };

  const toggleParticipant = (member: Member, selected: boolean) => {
    setTeams((current) =>
      current.map((team) =>
        team.id === "A"
          ? {
              ...team,
              members: selected
                ? [
                    ...team.members.filter((entry) => entry.id !== member.id),
                    member,
                  ]
                : team.members.filter((entry) => entry.id !== member.id),
            }
          : team,
      ),
    );
    setPool((current) =>
      selected
        ? current.filter((entry) => entry.id !== member.id)
        : [...current.filter((entry) => entry.id !== member.id), member],
    );
  };

  const handlePercentChange = (teamId: string, value: number) => {
    setTeams(
      teams.map((t) => (t.id === teamId ? { ...t, percent: value } : t)),
    );
  };

  const handleTeamNameChange = (teamId: string, newName: string) => {
    setTeams(teams.map((t) => (t.id === teamId ? { ...t, name: newName } : t)));
  };

  const handleMemberPercentChange = (
    teamId: string,
    memberId: string,
    percent: number | undefined,
  ) => {
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? {
              ...t,
              members: t.members.map((m) =>
                m.id === memberId
                  ? {
                      ...m,
                      percent:
                        percent === undefined ||
                        percent === null ||
                        isNaN(percent) ||
                        percent === 100
                          ? undefined
                          : Math.max(1, percent),
                      reason:
                        percent === undefined ||
                        percent === null ||
                        isNaN(percent) ||
                        percent === 100
                          ? undefined
                          : m.reason,
                    }
                  : m,
              ),
            }
          : t,
      ),
    );
  };

  const handleMemberReasonChange = (
    teamId: string,
    memberId: string,
    reason: string,
  ) => {
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? {
              ...t,
              members: t.members.map((m) =>
                m.id === memberId ? { ...m, reason } : m,
              ),
            }
          : t,
      ),
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
      type: usesTeams ? "SHARED" : "EQUAL",
      teamPercents: usesTeams ? defaultPercents : { A: 100, B: 0, C: 0 },
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
    value: any,
  ) => {
    setExpenseItems((prev) =>
      prev.map((e) => (e.id === expenseId ? { ...e, [field]: value } : e)),
    );
  };

  const calculatedShares = useMemo(() => {
    const totalSubsidyAmount = expenseItems
      .filter((e) => e.type === "SUBSIDY")
      .reduce((sum, e) => sum + e.amount, 0);

    const totalSharedExpenses = expenseItems
      .filter((e) => e.type !== "SUBSIDY" && e.type !== "INDIVIDUAL")
      .reduce((sum, e) => sum + e.amount, 0);

    const totalIndividualExpenses = expenseItems
      .filter((e) => e.type === "INDIVIDUAL")
      .reduce((sum, e) => sum + e.amount, 0);

    const grandMatchTotal = totalSharedExpenses + totalIndividualExpenses;
    const netSharedPool = Math.max(0, totalSharedExpenses - totalSubsidyAmount);
    const subsidyDiscountFactor = totalSharedExpenses > 0 ? netSharedPool / totalSharedExpenses : 1;

    const memberAmounts: {
      [key: string]: {
        totalAmount: number;
        details: { description: string; amount: number }[];
      };
    } = {};

    if (grandMatchTotal <= 0 && totalSubsidyAmount <= 0) return memberAmounts;

    // Loop through each expense
    expenseItems.forEach((expense) => {
      if (expense.amount <= 0) return;

      if (expense.type === "SUBSIDY") {
        if (expense.targetMemberId) {
          if (!memberAmounts[expense.targetMemberId]) {
            memberAmounts[expense.targetMemberId] = {
              totalAmount: 0,
              details: [],
            };
          }
          memberAmounts[expense.targetMemberId].totalAmount += expense.amount;
          const customDesc = expense.description?.trim() || "Trợ giá / Hỗ trợ";
          const noteDesc = expense.note?.trim() ? ` (${expense.note.trim()})` : "";
          memberAmounts[expense.targetMemberId].details.push({
            description: `[Trợ giá] ${customDesc}${noteDesc}`,
            amount: expense.amount,
          });
        }
        return;
      }

      if (expense.type === "INDIVIDUAL") {
        if (expense.targetMemberId) {
          if (!memberAmounts[expense.targetMemberId]) {
            memberAmounts[expense.targetMemberId] = {
              totalAmount: 0,
              details: [],
            };
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
            if (
              !m.isExemptFromPayment &&
              !expense.exemptMemberIds.includes(m.id)
            ) {
              eligibleMembers.push(m);
            }
          });
        });

        if (eligibleMembers.length > 0) {
          const effectiveAmount = Math.round(expense.amount * subsidyDiscountFactor);
          const shares = distributeAmountByWeights(
            eligibleMembers,
            effectiveAmount,
          );
          eligibleMembers.forEach((member) => {
            const memberAmount = shares.get(member.id) || 0;
            if (!memberAmounts[member.id]) {
              memberAmounts[member.id] = { totalAmount: 0, details: [] };
            }
            memberAmounts[member.id].totalAmount += memberAmount;
            const weightDesc =
              member.percent && member.percent < 100
                ? ` (${member.percent}%)`
                : "";
            const subsidyNote = totalSubsidyAmount > 0 ? " [Đã trừ trợ giá]" : "";
            memberAmounts[member.id].details.push({
              description: (expense.description || "Chia đều") + weightDesc + subsidyNote,
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
          (m) =>
            !m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id),
        );

        if (eligibleMembers.length === 0) return;

        const teamPercent = expense.teamPercents?.[team.id] ?? team.percent;
        const effectiveExpenseAmount = Math.round(expense.amount * subsidyDiscountFactor);
        const teamTotal = Math.round(effectiveExpenseAmount * (teamPercent / 100));

        const shares = distributeAmountByWeights(eligibleMembers, teamTotal);
        eligibleMembers.forEach((member) => {
          const memberAmount = shares.get(member.id) || 0;
          if (!memberAmounts[member.id]) {
            memberAmounts[member.id] = { totalAmount: 0, details: [] };
          }
          memberAmounts[member.id].totalAmount += memberAmount;
          const weightDesc =
            member.percent && member.percent < 100
              ? ` (${member.percent}%)`
              : "";
          const subsidyNote = totalSubsidyAmount > 0 ? " [Đã trừ trợ giá]" : "";
          memberAmounts[member.id].details.push({
            description: (expense.description || "Tiền sân") + weightDesc + subsidyNote,
            amount: memberAmount,
          });
        });
      });
    });

    // Adjust only for tiny rounding errors (e.g. integer division remainders <= 100 VND)
    // Large differences mean team members are not yet assigned, which is NOT a rounding error.
    // Crucially: NEVER adjust rounding error onto a SUBSIDY or INDIVIDUAL payer!
    const calculatedTotal = Object.values(memberAmounts).reduce(
      (sum, item) => sum + item.totalAmount,
      0,
    );
    const diff = grandMatchTotal - calculatedTotal;
    if (Math.abs(diff) > 0 && Math.abs(diff) <= 100) {
      const eligibleAdjustId = Object.keys(memberAmounts).find(
        (id) =>
          !expenseItems.some(
            (e) =>
              (e.type === "SUBSIDY" || e.type === "INDIVIDUAL") &&
              e.targetMemberId === id,
          ),
      );
      if (eligibleAdjustId && memberAmounts[eligibleAdjustId]) {
        memberAmounts[eligibleAdjustId].totalAmount += diff;
        const lastDetail =
          memberAmounts[eligibleAdjustId].details[
            memberAmounts[eligibleAdjustId].details.length - 1
          ];
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
        0,
      );
      return { name: team.name, amount };
    });

    const activeMemberIds = new Set(
      activeTeams.flatMap((t) => t.members.map((m) => m.id)),
    );
    const otherShares: { name: string; amount: number }[] = [];

    Object.entries(calculatedShares).forEach(([memberId, share]) => {
      if (!activeMemberIds.has(memberId) && share.totalAmount > 0) {
        const member = allMembers.find((m) => m.id === memberId);
        const subsidyItem = expenseItems.find(
          (e) => e.type === "SUBSIDY" && e.targetMemberId === memberId,
        );
        const label = subsidyItem
          ? `${member?.name || "Unknown"} [Trợ giá: ${subsidyItem.description || "Hỗ trợ"}]`
          : `${member?.name || "Unknown"} (Đòi riêng ngoài đội)`;
        otherShares.push({
          name: label,
          amount: share.totalAmount,
        });
      }
    });

    const totalDivided = Object.values(calculatedShares).reduce(
      (sum, s) => sum + s.totalAmount,
      0,
    );

    return {
      teamShares,
      otherShares,
      totalDivided,
    };
  }, [activeTeams, calculatedShares, allMembers]);

  const handleSaveConfigToDb = async () => {
    setIsSavingConfig(true);
    try {
      const kickoff = createMatchDate(date, time);
      const configToSave = {
        kickoffTime: time,
        expenseItems: sanitizeExpenseItems(expenseItems),
        teamCount: usesTeams ? teamCount : 1,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        attendanceReminderOnly,
        sufficientPlayerCount:
          sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
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
      const batch = writeBatch(db);
      batch.set(
        doc(db, ...settingsDocPath(groupId, "lastMatch")),
        configToSave,
      );
      if (matchId) {
        batch.update(doc(db, "matches", matchId), {
          date: kickoff,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      toast({
        title: "Đã lưu!",
        description: "Cấu hình trận đấu đã được lưu.",
      });
      return true;
    } catch (e: any) {
      console.error("Failed to save match config to DB:", e);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: e?.message ? `Không thể lưu cấu hình: ${e.message}` : "Không thể lưu cấu hình.",
      });
      return false;
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleUpdateMatchConfig = async () => {
    if (!matchId) return;
    setIsUpdatingConfig(true);
    try {
      const totalAmount = expenseItems
        .filter((e) => e.type !== "SUBSIDY")
        .reduce((sum, e) => sum + e.amount, 0);
      const matchRef = doc(db, "matches", matchId);
      const matchData: any = {
        date: createMatchDate(date, time),
        totalAmount: totalAmount,
        expenseItems: expenseItems,
        teamCount: usesTeams ? teamCount : 1,
        isTest: isTestMatch,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        attendanceReminderOnly,
        sufficientPlayerCount:
          sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
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
      const batch = writeBatch(db);
      batch.update(matchRef, matchData);

      // Only sync subsidy shares for already calculated/active matches (not PENDING)
      const existingSharesSnap = await getDocs(
        collection(db, "matches", matchId, "shares"),
      );

      const isPendingMatch = !existingStatus || existingStatus === "PENDING";

      if (isPendingMatch) {
        // If match is still in attendance (PENDING) and has not been calculated yet:
        // Do NOT create or keep orphaned debt shares in Firestore.
        // All bills should only be generated when admin clicks "Tính tiền".
        if (!existingSharesSnap.docs.some((d) => d.data().status === "PAID")) {
          existingSharesSnap.docs.forEach((docSnap) => {
            batch.delete(docSnap.ref);
          });
        }
      } else {
        const subsidyExpenses = expenseItems.filter(
          (e) => e.type === "SUBSIDY" && e.targetMemberId && e.amount > 0,
        );

        subsidyExpenses.forEach((exp) => {
          const existingShare = existingSharesSnap.docs.find(
            (d) =>
              d.data().memberId === exp.targetMemberId &&
              (d.data().teamId === "pool" || d.data().calculationDetails?.isIndividual),
          );
          const customDesc = exp.description?.trim() || "Trợ giá";
          const noteDesc = exp.note?.trim() ? ` (${exp.note.trim()})` : "";
          const breakdownItem = {
            expenseId: exp.id,
            description: `[Trợ giá] ${customDesc}${noteDesc}`,
            amount: exp.amount,
          };

          if (existingShare) {
            batch.update(existingShare.ref, {
              amount: exp.amount,
              expenseBreakdown: [breakdownItem],
              updatedAt: serverTimestamp(),
            });
          } else {
            const newShareRef = doc(collection(matchRef, "shares"));
            batch.set(newShareRef, {
              matchId: matchRef.id,
              memberId: exp.targetMemberId,
              teamId: "pool",
              amount: exp.amount,
              status: "PENDING",
              orderCode: "",
              expenseBreakdown: [breakdownItem],
              calculationDetails: {
                isIndividual: true,
              },
              groupId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        });
      }

      await batch.commit();
      toast({
        title: "Đã lưu!",
        description: isPendingMatch
          ? usesTeams
            ? "Chỉ cập nhật cấu hình/đội hình, chưa tính tiền."
            : "Đã cập nhật thông tin và người tham gia, chưa tính tiền."
          : "Đã lưu thay đổi cấu hình trận đấu.",
      });
    } catch (error: any) {
      console.error("Failed to update match config:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: error?.message ? `Không thể lưu cấu hình: ${error.message}` : "Không thể lưu cấu hình.",
      });
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const handleCreateMatch = async (withAttendance = true) => {
    if (withAttendance) {
      setIsCreatingWithAttendance(true);
    } else {
      setIsCreatingWithoutAttendance(true);
    }
    try {
      const totalAmount = expenseItems
        .filter((e) => e.type !== "SUBSIDY")
        .reduce((sum, e) => sum + e.amount, 0);
      const matchRef = doc(collection(db, "matches"));
      const matchData = {
        groupId,
        date: createMatchDate(date, time),
        totalAmount: totalAmount,
        expenseItems: sanitizeExpenseItems(expenseItems),
        teamCount: usesTeams ? teamCount : 1,
        status: "PENDING",
        isTest: isTestMatch,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        attendanceReminderOnly,
        sufficientPlayerCount:
          sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
        paidByMemberId: paidByMemberId || null,
        skipAutoAttendance: withAttendance ? skipAutoAttendance : true,
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

      if (withAttendance) {
        const attendanceLink = `${window.location.origin}${groupPath("public/attendance")}`;
        try {
          await navigator.clipboard.writeText(attendanceLink);
        } catch (clipErr) {
          console.warn("Could not copy to clipboard:", clipErr);
        }
        toast({
          title: "Tạo thành công!",
          description: usesTeams
            ? "Đã tạo trận điểm danh. Link điểm danh chung đã được sao chép."
            : "Đã tạo buổi điểm danh. Link điểm danh chung đã được sao chép.",
        });
        // Fire push notification cho members
        postApiJson("/notify/attendance-created", {
          matchId: matchRef.id,
          groupId,
        }).catch((error) =>
          console.error("Failed to send attendance created notification", error),
        );
      } else {
        toast({
          title: "Tạo thành công!",
          description: usesTeams
            ? "Đã tạo trận đấu mới (chưa mở điểm danh)."
            : "Đã tạo buổi chơi mới (chưa mở điểm danh).",
        });
      }

      navigate(groupPath(`admin/setup/${matchRef.id}`));
    } catch (error: any) {
      console.error("Failed to create match:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: error?.message ? `Không thể tạo: ${error.message}` : "Không thể tạo trận đấu.",
      });
    } finally {
      setIsCreatingWithAttendance(false);
      setIsCreatingWithoutAttendance(false);
    }
  };

  const handleCreateMatchForAttendance = async () => {
    return handleCreateMatch(true);
  };

  const handleSave = async (publish = false) => {
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
      } else if (expense.type === "SUBSIDY" && !expense.targetMemberId) {
        toast({
          title: `Lỗi thông tin ở Khoản ${i + 1}`,
          description: `Vui lòng chọn người thanh toán cho khoản trợ giá "${expense.description || "Trợ giá"}"`,
          variant: "destructive",
        });
        return;
      } else if (expense.type === "EQUAL") {
        const totalMembers = activeTeams.reduce(
          (sum, t) => sum + t.members.length,
          0,
        );
        if (totalMembers === 0) {
          toast({
            title: `Lỗi phân chia ở Khoản ${i + 1}`,
            description: `Không thể chia đều "${expense.description || "Khoản chi phí"}" khi chưa có người tham gia`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    const totalSubsidyAmount = expenseItems
      .filter((e) => e.type === "SUBSIDY")
      .reduce((sum, e) => sum + e.amount, 0);

    const totalSharedExpenses = expenseItems
      .filter((e) => e.type !== "SUBSIDY" && e.type !== "INDIVIDUAL")
      .reduce((sum, e) => sum + e.amount, 0);

    if (totalSubsidyAmount > totalSharedExpenses) {
      toast({
        title: "Lỗi trợ giá",
        description: `Tổng số tiền trợ giá (${totalSubsidyAmount.toLocaleString()}đ) không được vượt quá tổng chi phí chung (${totalSharedExpenses.toLocaleString()}đ)`,
        variant: "destructive",
      });
      return;
    }

    const numericTotalAmount = expenseItems
      .filter((e) => e.type !== "SUBSIDY")
      .reduce((sum, e) => sum + e.amount, 0);
    if (numericTotalAmount <= 0) {
      toast({
        title: "Lỗi số tiền",
        description: "Vui lòng nhập ít nhất một khoản chi phí có giá trị",
        variant: "destructive",
      });
      return;
    }
    if (
      activeTeams.some(
        (t) => getTeamEffectivePercent(t.id) > 0 && t.members.length === 0,
      )
    ) {
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
      const existingSharesSnapshot = matchId
        ? await getDocs(collection(db, "matches", matchId, "shares"))
        : null;
      if (
        existingSharesSnapshot?.docs.some(
          (snapshot) => snapshot.data().status === "PAID",
        )
      ) {
        toast({
          title: "Cannot recalculate paid bills",
          description:
            "This match already has payments. Use the configuration update to keep paid debts intact.",
          variant: "destructive",
        });
        return;
      }
      if (!(await handleSaveConfigToDb())) return;
      const nextStatus = publish ? "PUBLISHED" : "COMPLETED";

      const shares: Share[] = [];

      // Calculate shares per member with expense breakdown
      const memberSharesMap = new Map<
        string,
        {
          memberId: string;
          teamId: string;
          totalAmount: number;
          expenseBreakdown: {
            expenseId: string;
            description: string;
            amount: number;
          }[];
          calculationDetails?: Share["calculationDetails"] & {
            isEqual?: boolean;
            isIndividual?: boolean;
          };
        }
      >();

      const netSharedPool = Math.max(0, totalSharedExpenses - totalSubsidyAmount);
      const subsidyDiscountFactor =
        totalSharedExpenses > 0 ? netSharedPool / totalSharedExpenses : 1;

      expenseItems.forEach((expense) => {
        if (expense.amount <= 0) return;

        if (expense.type === "SUBSIDY") {
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
            const customDesc = expense.description?.trim() || "Trợ giá / Hỗ trợ";
            const noteDesc = expense.note?.trim() ? ` (${expense.note.trim()})` : "";
            memberShare.expenseBreakdown.push({
              expenseId: expense.id,
              description: `[Trợ giá] ${customDesc}${noteDesc}`,
              amount: expense.amount,
            });
          }
          return;
        }

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
              description:
                (expense.description || "Đòi riêng") + " (Đòi riêng)",
              amount: expense.amount,
            });
          }
          return;
        }

        if (expense.type === "EQUAL") {
          const eligibleMembers: { member: Member; teamId: string }[] = [];
          activeTeams.forEach((team) => {
            team.members.forEach((m) => {
              if (
                !m.isExemptFromPayment &&
                !expense.exemptMemberIds.includes(m.id)
              ) {
                eligibleMembers.push({ member: m, teamId: team.id });
              }
            });
          });

          if (eligibleMembers.length > 0) {
            const effectiveAmount = Math.round(
              expense.amount * subsidyDiscountFactor,
            );
            const shares = distributeAmountByWeights(
              eligibleMembers.map((e) => e.member),
              effectiveAmount,
            );

            eligibleMembers.forEach(({ member, teamId }) => {
              const memberAmount = shares.get(member.id) || 0;

              if (!memberSharesMap.has(member.id)) {
                memberSharesMap.set(member.id, {
                  memberId: member.id,
                  teamId: teamId,
                  totalAmount: 0,
                  expenseBreakdown: [],
                  calculationDetails: {
                    isEqual: true,
                    ...(member.percent && member.percent < 100
                      ? { memberPercent: member.percent }
                      : {}),
                    ...(member.reason ? { reason: member.reason } : {}),
                  },
                });
              }

              const memberShare = memberSharesMap.get(member.id)!;
              memberShare.totalAmount += memberAmount;
              const weightDesc =
                member.percent && member.percent < 100
                  ? ` (${member.percent}%)`
                  : "";
              const subsidyNote = totalSubsidyAmount > 0 ? " [Đã trừ trợ giá]" : "";
              memberShare.expenseBreakdown.push({
                expenseId: expense.id,
                description: (expense.description || "Chia đều") + weightDesc + subsidyNote,
                amount: memberAmount,
              });
            });
          }
          return;
        }

        activeTeams.forEach((team) => {
          if (team.members.length === 0) return;

          const eligibleMembers = team.members.filter(
            (m) =>
              !m.isExemptFromPayment && !expense.exemptMemberIds.includes(m.id),
          );

          if (eligibleMembers.length === 0) return;

          const teamPercent = expense.teamPercents?.[team.id] ?? team.percent;
          const effectiveExpenseAmount = Math.round(
            expense.amount * subsidyDiscountFactor,
          );
          const teamTotal = Math.round(
            effectiveExpenseAmount * (teamPercent / 100),
          );

          const shares = distributeAmountByWeights(eligibleMembers, teamTotal);

          eligibleMembers.forEach((member) => {
            const memberAmount = shares.get(member.id) || 0;

            if (!memberSharesMap.has(member.id)) {
              memberSharesMap.set(member.id, {
                memberId: member.id,
                teamId: team.id,
                totalAmount: 0,
                expenseBreakdown: [],
                calculationDetails: {
                  ...(member.percent && member.percent < 100
                    ? { memberPercent: member.percent }
                    : {}),
                  ...(member.reason ? { reason: member.reason } : {}),
                  teamName: team.name,
                  teamTotal: teamTotal,
                },
              });
            }

            const memberShare = memberSharesMap.get(member.id)!;
            memberShare.totalAmount += memberAmount;
            const weightDesc =
              member.percent && member.percent < 100
                ? ` (${member.percent}%)`
                : "";
            const subsidyNote = totalSubsidyAmount > 0 ? " [Đã trừ trợ giá]" : "";
            memberShare.expenseBreakdown.push({
              expenseId: expense.id,
              description: (expense.description || "Tiền sân") + weightDesc + subsidyNote,
              amount: memberAmount,
            });
          });
        });
      });

      // Convert map to shares array
      memberSharesMap.forEach((memberShare) => {
        const memberObj = allMembers.find((m) => m.id === memberShare.memberId);
        const calcDetails = memberShare.calculationDetails
          ? Object.fromEntries(
              Object.entries(memberShare.calculationDetails).filter(
                ([_, v]) => v !== undefined,
              ),
            )
          : undefined;
        shares.push({
          matchId: matchRef.id,
          memberId: memberShare.memberId,
          teamId: memberShare.teamId,
          amount: memberShare.totalAmount,
          status: "PENDING",
          orderCode: "",
          expenseBreakdown: memberShare.expenseBreakdown,
          ...(calcDetails && Object.keys(calcDetails).length > 0
            ? { calculationDetails: calcDetails }
            : {}),
        });
      });

      // Recalculate total and adjust for small rounding errors (<= 100 VND)
      // Never apply rounding differences to SUBSIDY or INDIVIDUAL shares!
      const calculatedTotal = shares.reduce((sum, s) => sum + s.amount, 0);
      const diff = numericTotalAmount - calculatedTotal;
      if (Math.abs(diff) > 0 && Math.abs(diff) <= 100 && shares.length > 0) {
        const eligibleShare = shares.find(
          (s) =>
            !expenseItems.some(
              (e) =>
                (e.type === "SUBSIDY" || e.type === "INDIVIDUAL") &&
                e.targetMemberId === s.memberId,
            ),
        );
        if (eligibleShare) {
          eligibleShare.amount += diff;
        }
      }

      const batch = writeBatch(db);

      const matchData = {
        groupId,
        date: createMatchDate(date, time),
        totalAmount: numericTotalAmount,
        expenseItems: sanitizeExpenseItems(expenseItems),
        teamCount: usesTeams ? teamCount : 1,
        isTest: isTestMatch,
        venueName: venueName || null,
        mapIframe: mapIframe || null,
        attendanceCloseHours,
        attendanceReminderOnly,
        sufficientPlayerCount:
          sufficientPlayerCount === "" ? null : Number(sufficientPlayerCount),
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
        status: nextStatus,
        updatedAt: serverTimestamp(),
        ...(publish ? { wasPublished: true } : {}),
        ...(publish && !wasPublished ? { publishedAt: serverTimestamp() } : {}),
      };

      if (matchId) {
        batch.update(matchRef, matchData);
      } else {
        batch.set(matchRef, { ...matchData, createdAt: serverTimestamp() });
      }

      // Map existing shares by memberId so we preserve PAID status and payment metadata
      const existingSharesByMember = new Map<
        string,
        { id: string; ref: any; data: any }
      >();
      existingSharesSnapshot?.forEach((snapshot) => {
        const d = snapshot.data();
        if (d.memberId) {
          existingSharesByMember.set(d.memberId, {
            id: snapshot.id,
            ref: snapshot.ref,
            data: d,
          });
        }
      });

      // Delete existing shares that are no longer in the new shares list
      const newMemberIds = new Set(shares.map((s) => s.memberId));
      existingSharesSnapshot?.forEach((snapshot) => {
        const d = snapshot.data();
        if (!newMemberIds.has(d.memberId)) {
          batch.delete(snapshot.ref);
        }
      });

      // Update or create shares, preserving PAID status and payment metadata
      shares.forEach((share) => {
        const existing = existingSharesByMember.get(share.memberId);
        const shareRef = existing
          ? existing.ref
          : doc(collection(matchRef, "shares"));
        const finalStatus =
          existing?.data?.status === "PAID" ? "PAID" : share.status;
        const finalPaidAt =
          existing?.data?.status === "PAID"
            ? existing.data.paidAt || new Date().toISOString()
            : undefined;
        const finalChannel = existing?.data?.channel || undefined;
        const finalOrderCode = existing?.data?.orderCode || share.orderCode;

        const shareData: Record<string, any> = {
          ...share,
          status: finalStatus,
          ...(finalPaidAt ? { paidAt: finalPaidAt } : {}),
          ...(finalChannel ? { channel: finalChannel } : {}),
          ...(finalOrderCode ? { orderCode: finalOrderCode } : {}),
          groupId,
          updatedAt: serverTimestamp(),
          ...(existing ? {} : { createdAt: serverTimestamp() }),
        };

        Object.keys(shareData).forEach((key) => {
          if (shareData[key] === undefined) {
            delete shareData[key];
          }
        });

        batch.set(shareRef, shareData, { merge: true });
      });

      await batch.commit();
      if (publish && !wasPublished && existingStatus !== "PUBLISHED") {
        void postApiJson("/notify/match-published", {
          matchId: matchRef.id,
          groupId,
        }).catch((error) => {
          console.error("Failed to send match-published notification", error);
        });
      }
      if (publish) {
        setWasPublished(true);
        if (typeof apiRequest === "function") {
          void apiRequest("POST", `/groups/${groupId}/elo/sync`).catch(() => {});
        }
      }
      setExistingStatus(nextStatus);
      toast({
        title: "Saved",
        description: publish
          ? "Match calculated and published. Members can now see their debts in Pay."
          : "Match calculated. Publish it when you are ready to collect payment.",
      });
      if (!matchId) navigate(groupPath(`admin/setup/${matchRef.id}`));
    } catch (error: any) {
      console.error("Failed to calculate and save match:", error);
      toast({
        title: "Lỗi!",
        description: error?.message
          ? `Không thể lưu trận đấu: ${error.message}`
          : "Không thể lưu trận đấu.",
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
        (am) => !teamA.members.some((tm) => tm.id === am.id),
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
      description: usesTeams
        ? `Đã thêm ${attendingMembers.length} thành viên vào Đội A.`
        : `Đã thêm ${attendingMembers.length} người đã điểm danh.`,
    });
  };

  const handleReset = () => {
    const membersInTeams = teams.flatMap((t) => t.members);
    const newPool = [...pool, ...membersInTeams];
    const resetTeams = teams.map((t) => ({ ...t, members: [] }));

    setPool(newPool);
    setTeams(resetTeams);

    toast({
      title: "Đã đặt lại danh sách!",
      description: "Tất cả thành viên đã được đưa về danh sách.",
    });
  };

  const handleAutoBalanceElo = () => {
    let playersToBalance = activeTeams.flatMap((t) => t.members);
    if (playersToBalance.length === 0) {
      playersToBalance = pool.filter((m) => attendance.has(m.id));
      if (playersToBalance.length === 0) {
        playersToBalance = [...pool];
      }
    }

    if (playersToBalance.length === 0) {
      toast({
        variant: "destructive",
        title: "Chưa có thành viên",
        description: "Không có thành viên nào để chia đội.",
      });
      return;
    }

    const { teams: balancedTeamLists, deltaElo } = balanceTeamsByElo(
      playersToBalance,
      activeTeams.length
    );

    const balancedIds = new Set(playersToBalance.map((m) => m.id));
    const remainingPool = pool.filter((m) => !balancedIds.has(m.id));

    const updatedTeams = teams.map((team, idx) => {
      if (idx < activeTeams.length) {
        return { ...team, members: balancedTeamLists[idx] || [] };
      }
      return team;
    });

    setPool(remainingPool);
    setTeams(updatedTeams);

    toast({
      title: "⚡ Đã chia đều theo ELO",
      description: `Đã phân chia ${playersToBalance.length} người vào ${activeTeams.length} đội (Độ chênh lệch: ${deltaElo} ELO).`,
    });
  };

  const filteredPool = useMemo(() => {
    if (!searchQuery) return pool;
    const lowerCaseQuery = removeDiacritics(searchQuery.toLowerCase());
    return pool.filter(
      (m) =>
        removeDiacritics(m.name.toLowerCase()).includes(lowerCaseQuery) ||
        (m.nickname &&
          removeDiacritics(m.nickname.toLowerCase()).includes(lowerCaseQuery)),
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
                {usesTeams
                  ? matchId
                    ? "Chỉnh sửa trận đấu"
                    : "Tạo trận đấu mới"
                  : matchId
                    ? "Chỉnh sửa buổi cầu lông"
                    : "Tạo buổi cầu lông"}
              </h1>
              <p className="text-muted-foreground">
                {matchId
                  ? `ID: ${matchId}`
                  : usesTeams
                    ? "Phân chia đội và tính tiền tự động"
                    : "Chọn người tham gia và chia chi phí buổi cầu lông"}
              </p>
            </div>
          </div>
        </div>

        {/* Template Selector Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border bg-card/60 backdrop-blur-xs shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <BookmarkPlus className="h-4 w-4 text-primary" />
              Mẫu cấu hình trận đấu:
            </span>
            <Select
              value={selectedTemplateId || "none"}
              onValueChange={(val) => {
                if (val === "none") return;
                const tpl = templates.find((t) => t.id === val);
                if (tpl) applyTemplate(tpl);
              }}
            >
              <SelectTrigger className="w-60 h-9 text-xs">
                <SelectValue placeholder="Chọn mẫu để điền nhanh..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- Chọn mẫu trận đấu --</SelectItem>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.isDefault ? `⭐ [Mặc định] ${tpl.name}` : tpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedTemplateId && (() => {
              const cur = templates.find((t) => t.id === selectedTemplateId);
              if (cur?.schedule?.enabled) {
                return (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded flex items-center gap-1 font-medium">
                    <Clock className="h-3 w-3" />
                    Tự động: Thứ {cur.schedule.dayOfWeek === 0 ? "CN" : cur.schedule.dayOfWeek + 1} lúc {cur.schedule.createHour}:00
                  </span>
                );
              }
              return null;
            })()}

            {/* Cập nhật mẫu đang chọn */}
            {selectedTemplateId && (() => {
              const cur = templates.find((t) => t.id === selectedTemplateId);
              if (!cur) return null;
              return (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleUpdateCurrentTemplate}
                        disabled={isUpdatingTemplate || isBusy}
                        className="text-xs h-9 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium"
                      >
                        {isUpdatingTemplate ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        Cập nhật mẫu: "{cur.name}"
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      <p>
                        Lưu các thông số vừa sửa (tiền sân, giờ, đội...) <b>đè vào mẫu "{cur.name}"</b> để các trận tạo mới sau này tự động áp dụng
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}

            {selectedTemplateId && (() => {
              const cur = templates.find((t) => t.id === selectedTemplateId);
              if (cur && !cur.isDefault) {
                return (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetTemplateAsDefault(cur)}
                          className="text-xs h-9 gap-1"
                        >
                          ⭐ Đặt làm mặc định
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[240px]">
                        <p>Đặt mẫu "{cur.name}" làm mẫu mặc định tự động điền khi tạo trận mới</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              }
              return null;
            })()}

            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsScheduleModalOpen(true)}
                    className="text-xs h-9 gap-1.5"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Lịch tự động & Mẫu
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px]">
                  <p>Xem danh sách tất cả mẫu và cài đặt tự động tạo trận hàng tuần</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsDefaultTemplate(false);
                      setNewTemplateName(venueName ? `Sân ${venueName}` : "");
                      setIsSaveTemplateOpen(true);
                    }}
                    className="gap-1.5 text-xs h-9"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    Lưu thành mẫu mới
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px]">
                  <p>Tạo một mẫu cấu hình riêng mới từ các thông số hiện tại</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {selectedTemplateId && (() => {
              const cur = templates.find((t) => t.id === selectedTemplateId);
              return (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteTemplate(selectedTemplateId)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-9 px-2"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Xóa mẫu "{cur?.name || "này"}"</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}
          </div>
        </div>

        <Dialog open={isSaveTemplateOpen} onOpenChange={setIsSaveTemplateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Lưu mẫu cấu hình trận đấu</DialogTitle>
              <DialogDescription>
                Lưu lại sân bóng, chi phí, giờ đá và các thông số hiện tại để áp
                dụng nhanh cho các trận sau hoặc lịch tự động.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="tpl-name">Tên mẫu trận đấu</Label>
                <Input
                  id="tpl-name"
                  placeholder="VD: Sân Chảo Lửa 19h, Sân Celadon 20h30..."
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                />
              </div>

              <div className="flex items-center space-x-2 pt-1 border-t">
                <Checkbox
                  id="tpl-default"
                  checked={isDefaultTemplate}
                  onCheckedChange={(c) => setIsDefaultTemplate(Boolean(c))}
                />
                <Label htmlFor="tpl-default" className="text-xs font-normal cursor-pointer">
                  Đặt làm mẫu mặc định (Tự động tải khi mở Tạo trận đấu mới)
                </Label>
              </div>

              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="tpl-sched" className="text-xs font-semibold cursor-pointer">
                      Lịch tạo trận tự động định kỳ
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Tự động tạo trận theo mẫu này và mở điểm danh hàng tuần
                    </p>
                  </div>
                  <Switch
                    id="tpl-sched"
                    checked={templateScheduleEnabled}
                    onCheckedChange={setTemplateScheduleEnabled}
                  />
                </div>

                {templateScheduleEnabled && (
                  <div className="grid grid-cols-2 gap-2 p-2.5 bg-muted/40 rounded-lg text-xs">
                    <div>
                      <Label className="text-[11px]">Thứ mở điểm danh</Label>
                      <Select
                        value={String(templateScheduleDay)}
                        onValueChange={(v) => setTemplateScheduleDay(Number(v))}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            { value: 1, label: "Thứ 2" },
                            { value: 2, label: "Thứ 3" },
                            { value: 3, label: "Thứ 4" },
                            { value: 4, label: "Thứ 5" },
                            { value: 5, label: "Thứ 6" },
                            { value: 6, label: "Thứ 7" },
                            { value: 0, label: "Chủ nhật" },
                          ].map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">Giờ thông báo</Label>
                      <Select
                        value={String(templateScheduleHour)}
                        onValueChange={(v) => setTemplateScheduleHour(Number(v))}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 16 }, (_, i) => i + 7).map((h) => (
                            <SelectItem key={h} value={String(h)}>
                              {h < 10 ? `0${h}:00` : `${h}:00`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">{group?.sport === "badminton" ? "Thứ đánh cầu" : "Thứ đá trận"}</Label>
                      <Select
                        value={String(templateMatchDay)}
                        onValueChange={(v) => setTemplateMatchDay(Number(v))}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            { value: 1, label: "Thứ 2" },
                            { value: 2, label: "Thứ 3" },
                            { value: 3, label: "Thứ 4" },
                            { value: 4, label: "Thứ 5" },
                            { value: 5, label: "Thứ 6" },
                            { value: 6, label: "Thứ 7" },
                            { value: 0, label: "Chủ nhật" },
                          ].map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">Giờ thi đấu</Label>
                      <Input
                        type="time"
                        value={templateMatchTime}
                        onChange={(e) => setTemplateMatchTime(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsSaveTemplateOpen(false)}
              >
                Hủy
              </Button>
              <Button
                onClick={handleSaveAsTemplate}
                disabled={!newTemplateName.trim() || isSavingTemplate}
              >
                {isSavingTemplate && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Lưu mẫu
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card className="mb-6 shadow-card">
          <CardHeader>
            <CardTitle>
              {usesTeams ? "Thông tin trận đấu" : "Thông tin buổi chơi"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
            <div className="space-y-2">
              <Label htmlFor="date">
                {usesTeams ? "Ngày đá" : "Ngày chơi"}
              </Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="date"
                  disabled={isBusy}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">
                {usesTeams ? "Giờ đá" : "Giờ bắt đầu"}
              </Label>
              <Input
                id="time"
                disabled={isBusy}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            {usesTeams && (
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
            )}
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
                <CardTitle>
                  {usesTeams ? "Chi phí trận đấu" : "Chi phí buổi chơi"}
                </CardTitle>
                <CardDescription>
                  Thêm các khoản chi phí (tiền sân, tiền nước, v.v.), cấu hình
                  tỷ lệ chia cho từng mục hoặc đòi tiền riêng.
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
                        handleUpdateExpense(
                          expense.id,
                          "description",
                          e.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`expense-amount-${expense.id}`}>
                      Số tiền (VND)
                    </Label>
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
                            parseFloat(e.target.value) || 0,
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
                    {usesTeams && (
                      <Button
                        type="button"
                        variant={
                          !expense.type || expense.type === "SHARED"
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        onClick={() =>
                          handleUpdateExpense(expense.id, "type", "SHARED")
                        }
                      >
                        Chia theo đội
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant={expense.type === "EQUAL" ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        handleUpdateExpense(expense.id, "type", "EQUAL")
                      }
                    >
                      Chia đều tất cả
                    </Button>
                    <Button
                      type="button"
                      variant={
                        expense.type === "INDIVIDUAL" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() =>
                        handleUpdateExpense(expense.id, "type", "INDIVIDUAL")
                      }
                    >
                      Thu riêng một người
                    </Button>
                    <Button
                      type="button"
                      variant={
                        expense.type === "SUBSIDY" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() =>
                        handleUpdateExpense(expense.id, "type", "SUBSIDY")
                      }
                      className={
                        expense.type === "SUBSIDY"
                          ? "bg-amber-600 hover:bg-amber-700 text-white"
                          : "border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      }
                    >
                      Trợ giá (Trừ tiền chung)
                    </Button>
                  </div>
                </div>

                {usesTeams && (!expense.type || expense.type === "SHARED") && (
                  <div className="space-y-3 pt-2">
                    <Label>Tỷ lệ chia giữa các đội (%)</Label>
                    <div className="flex flex-wrap gap-4 items-center">
                      {activeTeams.map((team) => {
                        const currentPercent =
                          expense.teamPercents?.[team.id] ??
                          teams.find((t) => t.id === team.id)?.percent ??
                          0;
                        return (
                          <div
                            key={team.id}
                            className="flex items-center gap-2"
                          >
                            <span className="text-xs font-semibold">
                              {team.name}:
                            </span>
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
                                    [team.id]: val,
                                  };
                                  activeTeams.forEach((t) => {
                                    if (updatedPercents[t.id] === undefined) {
                                      updatedPercents[t.id] = t.percent;
                                    }
                                  });
                                  handleUpdateExpense(
                                    expense.id,
                                    "teamPercents",
                                    updatedPercents,
                                  );
                                }}
                                className="pr-5 h-8 text-xs"
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                                %
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {(() => {
                        const sum = activeTeams.reduce((acc, team) => {
                          const p =
                            expense.teamPercents?.[team.id] ??
                            teams.find((t) => t.id === team.id)?.percent ??
                            0;
                          return acc + p;
                        }, 0);
                        return (
                          <Badge
                            variant={sum === 100 ? "outline" : "destructive"}
                            className="text-xs"
                          >
                            Tổng: {sum}%
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {(!expense.type ||
                  expense.type === "SHARED" ||
                  expense.type === "EQUAL") && (
                  <div className="space-y-2 pt-2">
                    <Label>
                      Miễn chia (chọn người không phải trả khoản này)
                    </Label>
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
                          aria-expanded={
                            activePopoverId === `exempt-${expense.id}`
                          }
                          className="w-full justify-between font-normal"
                        >
                          Chọn người được miễn chia...
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
                              {allMembers
                                .filter(
                                  (m) =>
                                    !expense.exemptMemberIds.includes(m.id),
                                )
                                .map((m) => (
                                  <CommandItem
                                    key={m.id}
                                    value={`${m.name} ${m.nickname || ""}`}
                                    onSelect={() => {
                                      handleUpdateExpense(
                                        expense.id,
                                        "exemptMemberIds",
                                        [...expense.exemptMemberIds, m.id],
                                      );
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
                          const member = allMembers.find(
                            (m) => m.id === memberId,
                          );
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
                                    expense.exemptMemberIds.filter(
                                      (id) => id !== memberId,
                                    ),
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
                    <Label htmlFor={`expense-target-${expense.id}`}>
                      Chọn thành viên cần đòi tiền
                    </Label>
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
                          aria-expanded={
                            activePopoverId === `target-${expense.id}`
                          }
                          className="w-full justify-between font-normal"
                        >
                          {expense.targetMemberId
                            ? (() => {
                                const m = allMembers.find(
                                  (member) =>
                                    member.id === expense.targetMemberId,
                                );
                                return m
                                  ? `${m.name}${m.nickname ? ` (${m.nickname})` : ""}`
                                  : "Chọn thành viên...";
                              })()
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
                              {allMembers.map((m) => (
                                <CommandItem
                                  key={m.id}
                                  value={`${m.name} ${m.nickname || ""}`}
                                  onSelect={() => {
                                    handleUpdateExpense(
                                      expense.id,
                                      "targetMemberId",
                                      m.id,
                                    );
                                    setActivePopoverId(null);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      expense.targetMemberId === m.id
                                        ? "opacity-100"
                                        : "opacity-0",
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

                {expense.type === "SUBSIDY" && (
                  <div className="space-y-4 pt-2 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 rounded-lg border border-amber-200 dark:border-amber-800">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Khoản trợ giá / hỗ trợ (Giảm tiền chung sân bóng)</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Khoản tiền này sẽ được trừ thẳng vào tổng tiền chung cần chia của trận đấu. Người được chọn dưới đây sẽ nhận một hóa đơn thanh toán riêng tương ứng với số tiền hỗ trợ này.
                      </p>
                    </div>

                    <div>
                      <div className="space-y-2 max-w-md">
                        <Label htmlFor={`expense-target-subsidy-${expense.id}`}>
                          Người thanh toán khoản hỗ trợ <span className="text-destructive">*</span>
                        </Label>
                        <Popover
                          open={activePopoverId === `subsidy-target-${expense.id}`}
                          onOpenChange={(open) =>
                            setActivePopoverId(
                              open ? `subsidy-target-${expense.id}` : null,
                            )
                          }
                        >
                          <PopoverTrigger asChild>
                            <Button
                              id={`expense-target-subsidy-${expense.id}`}
                              variant="outline"
                              role="combobox"
                              aria-expanded={
                                activePopoverId === `subsidy-target-${expense.id}`
                              }
                              className="w-full justify-between font-normal bg-background"
                            >
                              {expense.targetMemberId
                                ? (() => {
                                    const m = allMembers.find(
                                      (member) =>
                                        member.id === expense.targetMemberId,
                                    );
                                    return m
                                      ? `${m.name}${m.nickname ? ` (${m.nickname})` : ""}`
                                      : "Chọn người thanh toán...";
                                  })()
                                : "Chọn người thanh toán..."}
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
                                  {allMembers.map((m) => (
                                    <CommandItem
                                      key={m.id}
                                      value={`${m.name} ${m.nickname || ""}`}
                                      onSelect={() => {
                                        handleUpdateExpense(
                                          expense.id,
                                          "targetMemberId",
                                          m.id,
                                        );
                                        setActivePopoverId(null);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          expense.targetMemberId === m.id
                                            ? "opacity-100"
                                            : "opacity-0",
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
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className="pt-3 border-t space-y-2">
              {(() => {
                const totalSubsidyAmount = expenseItems
                  .filter((e) => e.type === "SUBSIDY")
                  .reduce((sum, e) => sum + e.amount, 0);
                const grandTotal = expenseItems
                  .filter((e) => e.type !== "SUBSIDY")
                  .reduce((sum, e) => sum + e.amount, 0);
                const netShared = Math.max(0, grandTotal - totalSubsidyAmount);

                return (
                  <>
                    {totalSubsidyAmount > 0 && (
                      <div className="text-xs space-y-1 bg-muted/40 p-2.5 rounded-md border text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Tổng chi phí trận đấu (trả người ứng):</span>
                          <span className="font-medium text-foreground">
                            {grandTotal.toLocaleString()} VND
                          </span>
                        </div>
                        <div className="flex justify-between text-amber-600 dark:text-amber-400 font-medium">
                          <span>Khoản trợ giá / hỗ trợ trừ vào tiền chung:</span>
                          <span>-{totalSubsidyAmount.toLocaleString()} VND</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 font-semibold text-foreground">
                          <span>Còn lại phân bổ cho các người chơi:</span>
                          <span>{netShared.toLocaleString()} VND</span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-lg font-semibold pt-1">
                      <span>Tổng chi phí trận đấu:</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-primary cursor-help border-b border-dashed border-primary">
                              {grandTotal.toLocaleString()} VND
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="p-3 max-w-[280px]">
                            <div className="space-y-2 text-xs">
                              <p className="font-bold border-b pb-1">
                                Chi tiết phân chia:
                              </p>
                              {matchDivisionDetails.teamShares.map((ts, idx) => (
                                <div key={idx} className="flex justify-between gap-4">
                                  <span>{ts.name}:</span>
                                  <span className="font-semibold">
                                    {Math.round(ts.amount).toLocaleString()}đ
                                  </span>
                                </div>
                              ))}
                              {matchDivisionDetails.otherShares.map((os, idx) => (
                                <div
                                  key={idx}
                                  className="flex justify-between gap-4 text-amber-600 dark:text-amber-400"
                                >
                                  <span>{os.name}:</span>
                                  <span className="font-semibold">
                                    {Math.round(os.amount).toLocaleString()}đ
                                  </span>
                                </div>
                              ))}
                              <div className="border-t pt-1 mt-1 flex justify-between font-bold text-primary">
                                <span>Tổng đã chia:</span>
                                <span>
                                  {Math.round(
                                    matchDivisionDetails.totalDivided,
                                  ).toLocaleString()}
                                  đ
                                </span>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </>
                );
              })()}
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
              Lưu cấu hình để dùng làm mặc định cho lần tiếp theo.
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
                    placeholder={
                      usesTeams ? "Sân bóng Phú Thọ" : "Tên sân cầu lông"
                    }
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="close-hours"
                  className="flex items-center gap-2"
                >
                  <Clock className="h-4 w-4" />
                  {attendanceReminderOnly
                    ? (usesTeams
                        ? "Nhắc nhở trước giờ đá (giờ)"
                        : "Nhắc nhở trước giờ chơi (giờ)")
                    : usesTeams
                        ? "Đóng điểm danh trước giờ đá (giờ)"
                        : "Đóng điểm danh trước giờ chơi (giờ)"}
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
                <div className="flex items-center justify-between rounded-lg border p-2.5 bg-muted/20">
                  <div className="space-y-0.5 pr-2">
                    <Label
                      htmlFor="attendance-reminder-only"
                      className="text-xs font-medium cursor-pointer"
                    >
                      Chỉ gửi nhắc nhở (không đóng điểm danh)
                    </Label>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      Đến mốc này chỉ gửi thông báo nhắc chốt sân. Thành viên vẫn có thể tiếp tục điểm danh thêm.
                    </p>
                  </div>
                  <Switch
                    id="attendance-reminder-only"
                    checked={attendanceReminderOnly}
                    onCheckedChange={setAttendanceReminderOnly}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Mặc định: 12 giờ trước giờ bắt đầu
                </p>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="sufficient-player-count"
                  className="flex items-center gap-2"
                >
                  <Users className="h-4 w-4" />
                  Số người tối thiểu để dừng nhắc nhở
                </Label>
                <Input
                  id="sufficient-player-count"
                  type="number"
                  min="0"
                  value={sufficientPlayerCount}
                  onChange={(e) =>
                    setSufficientPlayerCount(
                      e.target.value === ""
                        ? ""
                        : parseInt(e.target.value) || 0,
                    )
                  }
                  placeholder="Mặc định: 14"
                />
                <p className="text-xs text-muted-foreground">
                  Nếu đủ số người này điểm danh, các nhắc nhở điểm danh sẽ tự
                  động tắt.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paid-by" className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Người ứng tiền sân
                </Label>
                <Popover
                  open={paidByPopoverOpen}
                  onOpenChange={setPaidByPopoverOpen}
                >
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
                            const m = allMembers.find(
                              (member) => member.id === paidByMemberId,
                            );
                            return m
                              ? `${m.name}${m.nickname ? ` (${m.nickname})` : ""}`
                              : "Chọn người ứng tiền...";
                          })()
                        : "Chọn người ứng tiền (tùy chọn)"}
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
                                !paidByMemberId ? "opacity-100" : "opacity-0",
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
                                  paidByMemberId === m.id
                                    ? "opacity-100"
                                    : "opacity-0",
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
              <Label htmlFor="map-iframe">Google Maps iframe</Label>
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

        {usesTeams && (
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
        )}

        <div
          className={cn(
            "grid gap-4 md:grid-cols-2 mb-6",
            usesTeams && "lg:grid-cols-4",
          )}
        >
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
              {!usesTeams && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={handleLoadAttendance}
                >
                  Thêm người đã điểm danh
                </Button>
              )}
              <div className="flex flex-col gap-2 mt-2">
                {usesTeams && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAutoBalanceElo}
                    className="w-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 font-semibold"
                  >
                    <Sparkles className="h-4 w-4 mr-2 text-amber-500" />
                    Tự động chia theo ELO
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleReset}
                  className="w-full"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {usesTeams ? "Đặt lại đội" : "Bỏ chọn tất cả"}
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
                      <div className="min-w-0">
                        <p className="font-medium leading-tight break-words">{member.name}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {member.nickname && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 max-w-full truncate inline-block">
                              {member.nickname}
                            </Badge>
                          )}
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                            ⚡ {member.elo ?? 1000}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {attendance.has(member.id) && (
                          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                        )}
                        {!usesTeams && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleParticipant(member, true)}
                            aria-label={`Thêm ${member.name}`}
                          >
                            Thêm
                          </Button>
                        )}
                      </div>
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
                <CardTitle className="text-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-4 w-4 rounded-full ${team.color}`} />
                    <span>{team.name} ({team.members.length})</span>
                  </div>
                  {team.members.length > 0 && (
                    <Badge
                      variant="outline"
                      className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30"
                    >
                      TB: {Math.round(team.members.reduce((sum, m) => sum + (m.elo ?? 1000), 0) / team.members.length)} ELO
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="space-y-2">
                  {(() => {
                    const teamTotalAmount = team.members.reduce(
                      (sum, m) =>
                        sum + (calculatedShares[m.id]?.totalAmount || 0),
                      0,
                    );

                    const totalSubsidyAmount = expenseItems
                      .filter((e) => e.type === "SUBSIDY")
                      .reduce((sum, e) => sum + e.amount, 0);

                    const totalSharedExpenses = expenseItems
                      .filter((e) => e.type !== "SUBSIDY" && e.type !== "INDIVIDUAL")
                      .reduce((sum, e) => sum + e.amount, 0);

                    const netSharedPool = Math.max(0, totalSharedExpenses - totalSubsidyAmount);
                    const subsidyDiscountFactor =
                      totalSharedExpenses > 0 ? netSharedPool / totalSharedExpenses : 1;

                    // Gom các chi tiết khoản tiền của các thành viên trong đội dựa trên cấu hình chi phí và đính kèm %
                    const teamDetails: {
                      description: string;
                      amount: number;
                    }[] = [];

                    expenseItems.forEach((expense) => {
                      if (expense.amount <= 0) return;

                      if (expense.type === "SUBSIDY") {
                        const teamSubsidyAmount = team.members.reduce(
                          (sum, m) => {
                            if (expense.targetMemberId === m.id) {
                              return sum + expense.amount;
                            }
                            return sum;
                          },
                          0,
                        );
                        if (teamSubsidyAmount > 0) {
                          const customDesc = expense.description?.trim() || "Trợ giá";
                          teamDetails.push({
                            description: `[Trợ giá] ${customDesc}`,
                            amount: teamSubsidyAmount,
                          });
                        }
                        return;
                      }

                      if (expense.type === "INDIVIDUAL") {
                        const teamIndividualAmount = team.members.reduce(
                          (sum, m) => {
                            if (expense.targetMemberId === m.id) {
                              return sum + expense.amount;
                            }
                            return sum;
                          },
                          0,
                        );
                        if (teamIndividualAmount > 0) {
                          teamDetails.push({
                            description: `${expense.description || "Đòi riêng"} (Đòi riêng cá nhân)`,
                            amount: teamIndividualAmount,
                          });
                        }
                        return;
                      }

                      if (expense.type === "EQUAL") {
                        const allEligibleMembers: Member[] = [];
                        activeTeams.forEach((t) => {
                          t.members.forEach((m) => {
                            if (
                              !m.isExemptFromPayment &&
                              !expense.exemptMemberIds.includes(m.id)
                            ) {
                              allEligibleMembers.push(m);
                            }
                          });
                        });

                        if (allEligibleMembers.length > 0) {
                          const effectiveAmount = Math.round(
                            expense.amount * subsidyDiscountFactor,
                          );
                          const shares = distributeAmountByWeights(
                            allEligibleMembers,
                            effectiveAmount,
                          );
                          let teamEqualAmount = 0;
                          team.members.forEach((m) => {
                            if (
                              !m.isExemptFromPayment &&
                              !expense.exemptMemberIds.includes(m.id)
                            ) {
                              teamEqualAmount += shares.get(m.id) || 0;
                            }
                          });

                          if (teamEqualAmount > 0) {
                            const subsidyNote = totalSubsidyAmount > 0 ? " [Đã trừ trợ giá]" : "";
                            teamDetails.push({
                              description: `${expense.description || "Chia đều"} (Chia đều)${subsidyNote}`,
                              amount: teamEqualAmount,
                            });
                          }
                        }
                        return;
                      }

                      // SHARED / default
                      const teamPercent =
                        expense.teamPercents?.[team.id] ??
                        teams.find((t) => t.id === team.id)?.percent ??
                        0;
                      const effectiveExpenseAmount = Math.round(
                        expense.amount * subsidyDiscountFactor,
                      );
                      const teamTotal = Math.round(
                        effectiveExpenseAmount * (teamPercent / 100),
                      );

                      const eligibleMembers = team.members.filter(
                        (m) =>
                          !m.isExemptFromPayment &&
                          !expense.exemptMemberIds.includes(m.id),
                      );

                      if (eligibleMembers.length > 0) {
                        const shares = distributeAmountByWeights(
                          eligibleMembers,
                          teamTotal,
                        );
                        let teamSharedAmount = 0;
                        eligibleMembers.forEach((m) => {
                          teamSharedAmount += shares.get(m.id) || 0;
                        });

                        if (teamSharedAmount > 0) {
                          const subsidyNote = totalSubsidyAmount > 0 ? " [Đã trừ trợ giá]" : "";
                          teamDetails.push({
                            description: `${expense.description || "Tiền sân"} (${teamPercent}%)${subsidyNote}`,
                            amount: teamSharedAmount,
                          });
                        }
                      }
                    });

                    return (
                      <>
                        <div className="flex justify-between items-center text-sm font-semibold">
                          <span>
                            {usesTeams ? "Tổng tiền đội:" : "Tổng chi phí:"}
                          </span>
                          <span className="text-primary font-bold">
                            {teamTotalAmount.toLocaleString()} VND
                          </span>
                        </div>
                        {teamDetails.length > 0 && (
                          <div className="text-xs text-muted-foreground border-t pt-1.5 space-y-1">
                            {teamDetails.map((detail, idx) => (
                              <div key={idx} className="flex justify-between">
                                <span>{detail.description}:</span>
                                <span>
                                  {Math.round(detail.amount).toLocaleString()}đ
                                </span>
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
                      <div className="min-w-0">
                        <p className="font-medium leading-tight break-words">{member.name}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {member.nickname && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 max-w-full truncate inline-block">
                              {member.nickname}
                            </Badge>
                          )}
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                            ⚡ {member.elo ?? 1000}
                          </span>
                        </div>
                      </div>
                      {attendance.has(member.id) && (
                        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                      )}
                      {!usesTeams && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleParticipant(member, false)}
                          aria-label={`Bỏ ${member.name}`}
                        >
                          Bỏ
                        </Button>
                      )}
                      <div className="font-semibold text-primary">
                        {calculatedShares[member.id] ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-primary">
                                  {Math.round(
                                    calculatedShares[member.id].totalAmount,
                                  ).toLocaleString()}
                                  đ
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1 text-xs">
                                  <p className="font-bold border-b pb-1">
                                    Chi tiết tiền:
                                  </p>
                                  {calculatedShares[member.id].details.map(
                                    (detail, idx) => (
                                      <div
                                        key={idx}
                                        className="flex justify-between gap-4"
                                      >
                                        <span>{detail.description}:</span>
                                        <span className="font-semibold">
                                          {Math.round(
                                            detail.amount,
                                          ).toLocaleString()}
                                          đ
                                        </span>
                                      </div>
                                    ),
                                  )}
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
                        className="w-full justify-center text-xs py-1 text-muted-foreground"
                      >
                        Miễn chia tiền
                      </Badge>
                    ) : (
                      <div className="space-y-1.5 pt-1.5 border-t border-border/50">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="font-medium">Suất đóng:</span>
                          {member.percent && member.percent < 100 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              {member.percent}% (
                              {member.percent === 50
                                ? "½ suất"
                                : member.percent === 75
                                  ? "¾ suất"
                                  : `${member.percent}%`}
                              )
                            </span>
                          ) : member.percent && member.percent > 100 ? (
                            <span className="text-blue-600 dark:text-blue-400 font-semibold">
                              {member.percent}% ({member.percent / 100} suất)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              100% (1 suất)
                            </span>
                          )}
                        </div>

                        {(() => {
                          const isCustom =
                            customPercentMemberIds.has(member.id) ||
                            (typeof member.percent === "number" &&
                              member.percent > 0 &&
                              member.percent !== 50 &&
                              member.percent !== 75 &&
                              member.percent !== 100);

                          const isOneSuat =
                            !isCustom &&
                            (!member.percent || member.percent === 100);

                          const isHalfSuat =
                            !isCustom && member.percent === 50;
                          const isThreeQuarterSuat =
                            !isCustom && member.percent === 75;

                          return (
                            <>
                              {/* Quick preset chips */}
                              <div className="grid grid-cols-4 gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isOneSuat ? "default" : "outline"}
                                  className={cn(
                                    "h-7 text-xs px-1",
                                    isOneSuat &&
                                      "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold border-emerald-600 shadow-xs",
                                  )}
                                  onClick={() => {
                                    setCustomPercentMemberIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(member.id);
                                      return next;
                                    });
                                    handleMemberPercentChange(
                                      team.id,
                                      member.id,
                                      undefined,
                                    );
                                  }}
                                >
                                  1 suất
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isHalfSuat ? "default" : "outline"}
                                  className={cn(
                                    "h-7 text-xs px-1",
                                    isHalfSuat &&
                                      "bg-amber-500 hover:bg-amber-600 text-white font-semibold border-amber-500",
                                  )}
                                  onClick={() => {
                                    setCustomPercentMemberIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(member.id);
                                      return next;
                                    });
                                    handleMemberPercentChange(team.id, member.id, 50);
                                    if (!member.reason) {
                                      handleMemberReasonChange(
                                        team.id,
                                        member.id,
                                        "Về sớm (½ suất)",
                                      );
                                    }
                                  }}
                                >
                                  ½ suất
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isThreeQuarterSuat ? "default" : "outline"}
                                  className={cn(
                                    "h-7 text-xs px-1",
                                    isThreeQuarterSuat &&
                                      "bg-amber-500 hover:bg-amber-600 text-white font-semibold border-amber-500",
                                  )}
                                  onClick={() => {
                                    setCustomPercentMemberIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(member.id);
                                      return next;
                                    });
                                    handleMemberPercentChange(team.id, member.id, 75);
                                    if (!member.reason) {
                                      handleMemberReasonChange(
                                        team.id,
                                        member.id,
                                        "Về sớm (¾ suất)",
                                      );
                                    }
                                  }}
                                >
                                  ¾ suất
                                </Button>

                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isCustom ? "default" : "outline"}
                                  className={cn(
                                    "h-7 text-xs px-1",
                                    isCustom &&
                                      "bg-amber-500 hover:bg-amber-600 text-white font-semibold border-amber-500",
                                  )}
                                  onClick={() => {
                                    setCustomPercentMemberIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(member.id)) {
                                        next.delete(member.id);
                                        if (member.percent !== 50 && member.percent !== 75) {
                                          handleMemberPercentChange(
                                            team.id,
                                            member.id,
                                            undefined,
                                          );
                                        }
                                      } else {
                                        next.add(member.id);
                                      }
                                      return next;
                                    });
                                  }}
                                >
                                  Khác %
                                </Button>
                              </div>

                              {/* Custom % input */}
                              {isCustom && (
                                <div className="relative">
                                  <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                  <Input
                                    type="number"
                                    min={1}
                                    max={300}
                                    placeholder="Nhập % (vd: 40 hoặc 150)"
                                    value={member.percent ?? ""}
                                    onChange={(e) => {
                                      const val =
                                        e.target.value === ""
                                          ? undefined
                                          : parseInt(e.target.value, 10);
                                      handleMemberPercentChange(
                                        team.id,
                                        member.id,
                                        val,
                                      );
                                    }}
                                    className="pl-8 pr-8 h-8 text-xs"
                                  />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                                    %
                                  </span>
                                </div>
                              )}

                              {/* Reason input when reduced or custom */}
                              {((typeof member.percent === "number" &&
                                member.percent !== 100) ||
                                isCustom) && (
                                <div className="relative">
                                  <MessageSquarePlus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                  <Input
                                    type="text"
                                    placeholder={
                                      usesTeams
                                        ? "Lý do (vd: đá 1 hiệp, về sớm)"
                                        : "Lý do (vd: về sớm, chơi nửa buổi)"
                                    }
                                    value={member.reason || ""}
                                    onChange={(e) =>
                                      handleMemberReasonChange(
                                        team.id,
                                        member.id,
                                        e.target.value,
                                      )
                                    }
                                    className="pl-8 h-8 text-xs"
                                  />
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Dedicated section for External / Sponsor Shares (Không cần tham gia vào sân) */}
        {(() => {
          const activeMemberIds = new Set(
            activeTeams.flatMap((t) => t.members.map((m) => m.id)),
          );
          const externalShares = Object.entries(calculatedShares).filter(
            ([memberId, share]) =>
              !activeMemberIds.has(memberId) && share.totalAmount > 0,
          );

          if (externalShares.length === 0) return null;

          return (
            <Card className="mb-6 shadow-card border-amber-300/80 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-amber-800 dark:text-amber-300">
                  <Sparkles className="h-4 w-4" />
                  Khoản thu Trợ giá & Thu riêng ngoài đội ({externalShares.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Thành viên dưới đây <strong>không cần kéo vào đội / không tham gia đá bóng</strong>. Họ chỉ nhận hóa đơn đóng tiền trợ giá hoặc khoản đòi riêng tương ứng.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {externalShares.map(([memberId, share]) => {
                    const member = allMembers.find((m) => m.id === memberId);
                    const isSubsidy = expenseItems.some(
                      (e) =>
                        e.type === "SUBSIDY" && e.targetMemberId === memberId,
                    );
                    return (
                      <div
                        key={memberId}
                        className="p-3 rounded-lg border bg-card shadow-xs space-y-2"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-sm">
                                {member?.name || "Unknown"}
                              </span>
                              <Badge
                                variant="outline"
                                className={
                                  isSubsidy
                                    ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-300 text-[11px]"
                                    : "text-[11px]"
                                }
                              >
                                {isSubsidy
                                  ? "⭐ Nhà tài trợ / Trợ giá"
                                  : "Thu riêng"}
                              </Badge>
                            </div>
                            {member?.nickname && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                ({member.nickname})
                              </p>
                            )}
                          </div>
                          <span className="font-bold text-primary">
                            {share.totalAmount.toLocaleString()}đ
                          </span>
                        </div>

                        <div className="text-xs text-muted-foreground border-t pt-1.5 space-y-1">
                          {share.details.map((detail, idx) => (
                            <div
                              key={idx}
                              className="flex justify-between gap-2"
                            >
                              <span className="truncate">
                                {detail.description}:
                              </span>
                              <span className="font-medium text-foreground shrink-0">
                                {detail.amount.toLocaleString()}đ
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <div className="sticky bottom-0 z-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border bg-background/95 backdrop-blur p-4 shadow-lg">
          {/* Nhóm 1: Tiện ích sao chép Link theo ngữ cảnh */}
          <div className="flex flex-wrap items-center gap-2">
            {existingStatus === "PUBLISHED" || existingStatus === "COMPLETED" ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyLink(
                          `${window.location.origin}${groupPath("public/pay")}`,
                          "Link thanh toán chung đã được sao chép.",
                        )
                      }
                      disabled={isSaving}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-4 w-4 mr-1.5" />
                      Link thanh toán
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Sao chép đường link thanh toán chung (/public/pay) để gửi cho thành viên
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyLink(
                          `${window.location.origin}${groupPath("public/attendance")}`,
                          "Link điểm danh đã được sao chép.",
                        )
                      }
                      disabled={isSaving}
                      className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                    >
                      <LinkIcon className="h-4 w-4 mr-1.5" />
                      Link điểm danh
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Sao chép đường link điểm danh (/public/attendance) của buổi chơi này
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

          </div>

          {/* Nhóm 2: Thao tác buổi chơi & Tính tiền */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!matchId && (
              <>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => void handleCreateMatch(false)}
                        disabled={isBusy}
                        variant="outline"
                      >
                        {isCreatingWithoutAttendance ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        {usesTeams
                          ? "Tạo trận (không điểm danh)"
                          : "Tạo buổi (không điểm danh)"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[260px]">
                      <p>
                        Tạo trận mới mà <b>không</b> mở cổng điểm danh và không
                        gửi thông báo cho nhóm
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => void handleCreateMatch(true)}
                        disabled={isBusy}
                        variant="default"
                        className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
                      >
                        {isCreatingWithAttendance ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <LinkIcon className="h-4 w-4 mr-2" />
                        )}
                        {usesTeams
                          ? "Tạo trận & mở điểm danh"
                          : "Tạo buổi & mở điểm danh"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[260px]">
                      <p>
                        Tạo buổi chơi mới ở trạng thái chờ điểm danh (PENDING),
                        tự động copy link điểm danh và gửi thông báo cho nhóm
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}

            {matchId && (
              <>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleUpdateMatchConfig}
                        disabled={isBusy}
                        variant="secondary"
                      >
                        {isUpdatingConfig ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Lưu thay đổi trận đấu
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      <p>
                        Lưu lại thông tin sân, giờ, người tham gia, chi phí cho <b>riêng trận đấu này</b> (Snapshot độc lập, không thay đổi mẫu gốc và CHƯA tính tiền)
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          onClick={() => void handleSave(false)}
                          variant="outline"
                          disabled={isBusy || hasPaidShares}
                        >
                          Chỉ tính tiền (nháp)
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      <p>
                        {hasPaidShares
                          ? "Trận đấu đã có thành viên thanh toán tiền. Không thể tính lại hóa đơn."
                          : "Chốt chia tiền cho từng người trong trận này và lưu bản nháp (COMPLETED) để kiểm tra nội bộ, chưa gửi link đòi tiền"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          onClick={() => void handleSave(true)}
                          disabled={isBusy || hasPaidShares}
                          className="bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-600 hover:to-rose-700 text-white shadow font-medium"
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Đang lưu...
                            </>
                          ) : (
                            "Tính tiền & công khai"
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      <p>
                        {hasPaidShares
                          ? "Trận đấu đã có thành viên thanh toán tiền. Không thể tính lại hóa đơn."
                          : "Chốt chia tiền cho từng người trong trận này và công khai hóa đơn (PUBLISHED) để thành viên có thể bấm link thanh toán"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
        </div>
      </div>
      <MatchScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          void loadTemplates();
        }}
      />
    </div>
  );
};

export default SetupMatch;
