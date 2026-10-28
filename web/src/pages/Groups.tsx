import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";
import { GROUP_SPORTS, SPORT_LABELS, GroupSport, GroupKind, groupKindOf, groupPath } from "@/lib/groups";
import { usePlatformAccount } from "@/hooks/usePlatformAccount";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Users,
  Trash2,
  Shield,
  Loader2,
  UserPlus,
  X,
  Pencil,
  CreditCard,
  Copy,
  ExternalLink,
  QrCode,
  CheckCircle2,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  LogOut,
  Trophy,
  Receipt,
  Layers,
  Search,
  MoreVertical,
  FlaskConical,
  History,
  Menu,
  Globe,
  CalendarCheck,
} from "lucide-react";

type Group = {
  id: string;
  name: string;
  sport?: GroupSport;
  kind?: GroupKind;
  status: string;
  role: string;
  ownerUid?: string | null;
  ownerDisplayName?: string | null;
  ownerEmail?: string | null;
  isTest?: boolean;
};

type CoManager = {
  uid: string;
  email: string;
  displayName?: string;
  role: string;
  isOwner?: boolean;
};

export function isTestGroup(g: { isTest?: boolean; name?: string; id?: string }): boolean {
  if (typeof g.isTest === "boolean") return g.isTest;
  const name = (g.name || "").toLowerCase();
  const id = (g.id || "").toLowerCase();
  return (
    name.startsWith("[test]") ||
    name.includes("(test)") ||
    id.startsWith("test-") ||
    id.includes("-test") ||
    id === "test"
  );
}

function slugifyName(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

const Groups = () => {
  const navigate = useNavigate();
  const { account } = usePlatformAccount();
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Create Group State
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [sport, setSport] = useState<GroupSport | "">("");
  const [kind, setKind] = useState<GroupKind>("sports");
  const [isTest, setIsTest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoAddMeMember, setAutoAddMeMember] = useState(true);

  // Edit Group State
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [editName, setEditName] = useState("");
  const [editSport, setEditSport] = useState<GroupSport | "">("");
  const [editIsTest, setEditIsTest] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Super Admin Settlement Overview State
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementData, setSettlementData] = useState<any>(null);
  const [settlementTab, setSettlementTab] = useState<"pending" | "history">("pending");
  const [settlementHistory, setSettlementHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedGroupQr, setSelectedGroupQr] = useState<any>(null);
  const [batchSettlingGid, setBatchSettlingGid] = useState<string | null>(null);
  const [settlingAllPast, setSettlingAllPast] = useState(false);
  const [settlingMatchId, setSettlingMatchId] = useState<string | null>(null);
  const [linkingMemberId, setLinkingMemberId] = useState<string | null>(null);
  const [showOwnerMatches, setShowOwnerMatches] = useState(false);

  // Delete Group State
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Co-Managers State
  const [selectedGroupForManagers, setSelectedGroupForManagers] = useState<Group | null>(null);
  const [coManagers, setCoManagers] = useState<CoManager[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [newManagerEmail, setNewManagerEmail] = useState("");
  const [newManagerRole, setNewManagerRole] = useState<"manager" | "admin">("manager");
  const [addingManager, setAddingManager] = useState(false);

  // Category & Filter State
  const [activeCategory, setActiveCategory] = useState<"all" | "sports" | "shared_bills">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTestSectionOpen, setIsTestSectionOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const sportGroups = useMemo(() => {
    return groups.filter((g) => {
      const isSport = groupKindOf(g) !== "shared_bills";
      if (!isSport) return false;
      if (isTestGroup(g)) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q);
    });
  }, [groups, searchQuery]);

  const sharedBillGroups = useMemo(() => {
    return groups.filter((g) => {
      const isShared = groupKindOf(g) === "shared_bills";
      if (!isShared) return false;
      if (isTestGroup(g)) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q);
    });
  }, [groups, searchQuery]);

  const testGroups = useMemo(() => {
    return groups.filter((g) => {
      if (!isTestGroup(g)) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q);
    });
  }, [groups, searchQuery]);

  const displayedTestGroups = useMemo(() => {
    return testGroups.filter((g) => {
      if (activeCategory === "sports") return groupKindOf(g) !== "shared_bills";
      if (activeCategory === "shared_bills") return groupKindOf(g) === "shared_bills";
      return true;
    });
  }, [testGroups, activeCategory]);

  const isTestSectionVisible = isTestSectionOpen || (Boolean(searchQuery.trim()) && displayedTestGroups.length > 0);

  const fetchGroups = () => {
    setLoading(true);
    apiRequest("GET", "/platform/groups")
      .then((data) => setGroups(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManuallyEdited) {
      setSlug(slugifyName(val));
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((kind === "sports" && !sport) || name.trim().length < 2) {
      toast({ variant: "destructive", title: "Nhập tên nhóm và chọn môn thể thao" });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        kind,
        isTest,
        ...(kind === "sports" ? { sport } : {}),
      };
      if (slug.trim()) {
        payload.id = slug.trim().toLowerCase();
      }
      const created = await apiRequest("POST", "/platform/groups", payload);

      if (autoAddMeMember && user) {
        try {
          await addDoc(collection(db, "members"), {
            groupId: created.id,
            name: account?.displayName || user.displayName || "Quản lý nhóm",
            accountUid: user.uid,
            isPlatformOwner: account?.role === "owner",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (mErr) {
          console.warn("Could not auto-seed creator member:", mErr);
        }
      }

      toast({ title: "Tạo nhóm thành công!" });
      navigate(groupPath(created.id, "admin"));
    } catch (err: any) {
      const msg = err?.message?.includes("GROUP_ID_EXISTS")
        ? "Mã đường dẫn nhóm (slug) đã tồn tại, vui lòng chọn mã khác."
        : "Không thể tạo nhóm. Vui lòng kiểm tra lại.";
      toast({ variant: "destructive", title: "Lỗi", description: msg });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupToDelete) return;
    setIsDeleting(true);
    try {
      await apiRequest("DELETE", `/platform/groups/${groupToDelete.id}`);
      setGroups((prev) => prev.filter((g) => g.id !== groupToDelete.id));
      toast({ title: "Đã xóa nhóm thành công" });
      setGroupToDelete(null);
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể xóa nhóm này." });
    } finally {
      setIsDeleting(false);
    }
  };

  const openCoManagers = async (group: Group) => {
    setSelectedGroupForManagers(group);
    setLoadingManagers(true);
    try {
      const data = await apiRequest("GET", `/platform/groups/${group.id}/co-managers`);
      setCoManagers(data || []);
    } catch {
      toast({ variant: "destructive", title: "Không thể tải danh sách đồng quản lý" });
    } finally {
      setLoadingManagers(false);
    }
  };

  const handleAddCoManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupForManagers || !newManagerEmail.trim()) return;
    setAddingManager(true);
    try {
      await apiRequest("POST", `/platform/groups/${selectedGroupForManagers.id}/co-managers`, {
        email: newManagerEmail.trim(),
        role: newManagerRole,
      });
      toast({ title: "Đã thêm đồng quản lý thành công!" });
      setNewManagerEmail("");
      const updated = await apiRequest("GET", `/platform/groups/${selectedGroupForManagers.id}/co-managers`);
      setCoManagers(updated || []);
    } catch (err: any) {
      const desc = err?.message?.includes("ACCOUNT_NOT_FOUND")
        ? "Không tìm thấy tài khoản với email này. Hãy yêu cầu họ tạo tài khoản trước."
        : "Lỗi khi gán quyền quản lý.";
      toast({ variant: "destructive", title: "Lỗi", description: desc });
    } finally {
      setAddingManager(false);
    }
  };

  const handleRemoveCoManager = async (targetUid: string) => {
    if (!selectedGroupForManagers) return;
    try {
      await apiRequest("DELETE", `/platform/groups/${selectedGroupForManagers.id}/co-managers/${targetUid}`);
      setCoManagers((prev) => prev.filter((m) => m.uid !== targetUid));
      toast({ title: "Đã xóa đồng quản lý" });
    } catch {
      toast({ variant: "destructive", title: "Lỗi khi xóa đồng quản lý" });
    }
  };

  const handleToggleTestGroup = async (group: Group) => {
    const nextIsTest = !isTestGroup(group);
    try {
      await apiRequest("PATCH", `/platform/groups/${group.id}`, {
        isTest: nextIsTest,
      });
      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id ? { ...g, isTest: nextIsTest } : g,
        ),
      );
      toast({
        title: nextIsTest
          ? "Đã đánh dấu là nhóm thử nghiệm"
          : "Đã chuyển thành nhóm chính thức",
        description: nextIsTest
          ? `Nhóm "${group.name}" đã được chuyển vào mục nhóm thử nghiệm ở cuối trang.`
          : `Nhóm "${group.name}" đã được đưa lên danh sách nhóm chính.`,
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: err?.message || "Không thể cập nhật trạng thái thử nghiệm.",
      });
    }
  };

  const openEditGroup = (group: Group) => {
    setEditGroup(group);
    setEditName(group.name);
    setEditSport(group.sport || "");
    setEditIsTest(isTestGroup(group));
  };

  const handleSaveEditGroup = async () => {
    if (!editGroup || !editName.trim() || (groupKindOf(editGroup) === "sports" && !editSport)) return;
    setSavingEdit(true);
    try {
      await apiRequest("PATCH", `/platform/groups/${editGroup.id}`, {
        name: editName.trim(),
        isTest: editIsTest,
        ...(groupKindOf(editGroup) === "sports" ? { sport: editSport } : {}),
      });
      setGroups((prev) =>
        prev.map((g) =>
          g.id === editGroup.id
            ? { ...g, name: editName.trim(), sport: editSport as GroupSport, isTest: editIsTest }
            : g,
        ),
      );
      toast({ title: "Đã cập nhật thông tin nhóm" });
      setEditGroup(null);
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: e.message || "Không thể cập nhật nhóm",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const fetchSettlementOverview = async () => {
    setSettlementLoading(true);
    try {
      const data = await apiRequest("GET", "/platform/settlement/overview");
      setSettlementData(data);
    } catch (e) {
      toast({ variant: "destructive", title: "Không thể tải dữ liệu đối soát" });
    } finally {
      setSettlementLoading(false);
    }
  };

  const fetchSettlementHistory = async () => {
    setHistoryLoading(true);
    try {
      const data = await apiRequest("GET", "/platform/settlement/history");
      setSettlementHistory(data.history || []);
    } catch (e) {
      toast({ variant: "destructive", title: "Không thể tải lịch sử đối soát" });
    } finally {
      setHistoryLoading(false);
    }
  };

  const openSettlementOverview = () => {
    setSettlementTab("pending");
    setSettlementOpen(true);
    fetchSettlementOverview();
  };

  const handleBatchSettleGroup = async (groupItem: any) => {
    const matchesToSettle = (groupItem?.pendingMatches || []).filter((m: any) => !m.isOwnerPayer);
    if (!matchesToSettle.length) return;

    const uncollectedCount = matchesToSettle.filter((m: any) => !m.isFullyCollected).length;
    if (uncollectedCount > 0) {
      const confirmed = window.confirm(
        `Cảnh báo: Có ${uncollectedCount} trận chưa thu đủ tiền từ thành viên.\n\nBạn có chắc chắn muốn hoàn tiền cho tất cả ${matchesToSettle.length} trận không?`
      );
      if (!confirmed) return;
    }

    setBatchSettlingGid(groupItem.groupId);
    try {
      const matchIds = matchesToSettle.map((m: any) => m.id);
      await apiRequest("POST", "/platform/settlement/batch-settle", {
        groupId: groupItem.groupId,
        matchIds,
      });
      toast({ title: "Đã xác nhận hoàn tiền thành công cho các trận của nhóm" });
      setSelectedGroupQr(null);
      await fetchSettlementOverview();
      if (settlementTab === "history") await fetchSettlementHistory();
    } catch {
      toast({ variant: "destructive", title: "Không thể hoàn tất đối soát" });
    } finally {
      setBatchSettlingGid(null);
    }
  };

  const handleSettleSingleMatch = async (match: any, groupId: string, payerName: string) => {
    const gross = match.grossAmount ?? match.totalAmount;
    const payerShare = match.payerShareAmount || 0;
    const net = match.netPayoutAmount ?? (match.payerSharePaid ? gross : Math.max(0, gross - payerShare));

    let confirmMsg = `Xác nhận hoàn tiền trận đấu cho ${payerName}:\n`;
    confirmMsg += `• Tiền sân gốc: ${gross.toLocaleString()} VND\n`;
    if (payerShare > 0) {
      if (match.payerSharePaid) {
        confirmMsg += `• Phần người ứng: ${payerShare.toLocaleString()} VND (Đã nộp PayOS - Không khấu trừ)\n`;
      } else {
        confirmMsg += `• Khấu trừ phần người ứng: -${payerShare.toLocaleString()} VND (Tự động trừ vì chưa nộp PayOS)\n`;
      }
    }
    confirmMsg += `👉 Thực chuyển cho người ứng: ${net.toLocaleString()} VND\n\n`;

    if (!match.isFullyCollected) {
      confirmMsg += `⚠️ Chú ý: Trận này chưa thu đủ tiền từ các thành viên (Mới thu ${match.collectedAmount?.toLocaleString() || 0} / ${gross.toLocaleString()} VND).\n\n`;
    }
    confirmMsg += `Bạn có chắc chắn muốn xác nhận đã chuyển ${net.toLocaleString()} VND cho người ứng không?`;

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setSettlingMatchId(match.id);
    try {
      await apiRequest("POST", "/platform/settlement/batch-settle", {
        groupId,
        matchIds: [match.id],
        note: `Settled single match for payer ${payerName} (Net: ${net.toLocaleString()}đ, Gross: ${gross.toLocaleString()}đ)`,
      });
      toast({
        title: "Hoàn tiền thành công",
        description: `Đã hoàn tất đối soát ${net.toLocaleString()} VND cho ${payerName}.`,
      });
      await fetchSettlementOverview();
      if (settlementTab === "history") await fetchSettlementHistory();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Lỗi hoàn tiền",
        description: err.message || "Không thể cập nhật trạng thái trận đấu",
      });
    } finally {
      setSettlingMatchId(null);
    }
  };

  const handleToggleOwnerMember = async (groupId: string, memberId: string, isPlatformOwner: boolean) => {
    setLinkingMemberId(memberId);
    try {
      await apiRequest("POST", "/platform/settlement/link-owner-member", {
        groupId,
        memberId,
        isPlatformOwner,
      });
      toast({
        title: isPlatformOwner ? "Đã gán thành viên là Super Admin" : "Đã hủy gán Super Admin",
        description: isPlatformOwner
          ? "Các trận do thành viên này ứng sẽ không cần hoàn tiền (tiền đã về PayOS của bạn)."
          : "Thành viên này sẽ được tính hoàn tiền bình thường.",
      });
      await fetchSettlementOverview();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Lỗi cập nhật thành viên",
        description: err.message || "Không thể cập nhật liên kết Super Admin",
      });
    } finally {
      setLinkingMemberId(null);
    }
  };

  const handleSettleOwnerMatches = async (groupId: string, matches: any[]) => {
    if (!matches?.length) return;
    try {
      const matchIds = matches.map((m: any) => m.id);
      await apiRequest("POST", "/platform/settlement/batch-settle", {
        groupId,
        matchIds,
        note: "Super Admin self-settled all matches",
      });
      toast({ title: `Đã đóng đối soát ${matches.length} trận bạn tự ứng thành công` });
      await fetchSettlementOverview();
    } catch {
      toast({ variant: "destructive", title: "Không thể đóng đối soát" });
    }
  };

  const [settlingPayerKey, setSettlingPayerKey] = useState<string | null>(null);

  const handleSettlePayerMatches = async (groupId: string, payerName: string, matches: any[]) => {
    if (!matches?.length) return;
    const uncollectedCount = matches.filter((m: any) => !m.isFullyCollected).length;
    if (uncollectedCount > 0) {
      const confirmed = window.confirm(
        `Cảnh báo: Có ${uncollectedCount} / ${matches.length} trận chưa thu đủ tiền từ thành viên.\n\nBạn có chắc chắn muốn hoàn tiền cho tất cả ${matches.length} trận của ${payerName} không?`
      );
      if (!confirmed) return;
    }

    const payerKey = `${groupId}_${payerName}`;
    setSettlingPayerKey(payerKey);
    try {
      const matchIds = matches.map((m: any) => m.id);
      await apiRequest("POST", "/platform/settlement/batch-settle", {
        groupId,
        matchIds,
        note: `Settled all matches for payer ${payerName}`,
      });
      toast({
        title: "Hoàn tất đối soát người ứng",
        description: `Đã hoàn tất đối soát ${matches.length} trận cho ${payerName}.`,
      });
      await fetchSettlementOverview();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Lỗi hoàn tiền",
        description: err.message || "Không thể cập nhật trạng thái trận đấu",
      });
    } finally {
      setSettlingPayerKey(null);
    }
  };

  const handleSettleAllPast = async () => {
    if (!window.confirm("Bạn có chắc muốn đánh dấu tất cả các trận đấu cũ (trước hôm nay) ở mọi nhóm là ĐÃ HOÀN TIỀN?")) return;
    setSettlingAllPast(true);
    try {
      const res = await apiRequest("POST", "/platform/settlement/batch-settle", {
        allPast: true,
      });
      toast({ title: `Đã hoàn tiền ${res?.count || 0} trận đấu cũ thành công` });
      await fetchSettlementOverview();
    } catch {
      toast({ variant: "destructive", title: "Lỗi khi xử lý trận cũ" });
    } finally {
      setSettlingAllPast(false);
    }
  };

  const renderGroupCard = (group: Group) => {
    const isOwnerOrSuper = account?.role === "owner" || group.role === "owner";
    return (
      <Card
        key={group.id}
        onClick={() => navigate(groupPath(group.id, "admin"))}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(groupPath(group.id, "admin"));
          }
        }}
        className="group relative flex flex-col justify-between shadow-xs hover:shadow-md hover:border-primary/60 transition-all cursor-pointer active:scale-[0.99] bg-card"
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1.5 pr-2">
              <CardTitle className="break-words text-lg font-bold group-hover:text-primary transition-colors">
                {group.name}
              </CardTitle>
              <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                <a
                  href={`/g/${group.id}/public`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary hover:underline transition-colors"
                  title="Mở cổng thông tin công khai trong tab mới"
                >
                  /g/{group.id}
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </a>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  title="Sao chép link công khai"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(`${window.location.origin}/g/${group.id}/public`);
                    toast({
                      title: "Đã sao chép link công khai",
                      description: `${window.location.origin}/g/${group.id}/public`,
                    });
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-5 px-1.5 text-[11px] font-normal gap-1 text-muted-foreground hover:text-foreground border-dashed"
                      onClick={(e) => e.stopPropagation()}
                      title="Xem các liên kết công khai của nhóm"
                    >
                      <Globe className="h-2.5 w-2.5 text-primary" />
                      <span>Public Links</span>
                      <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuLabel className="text-xs font-semibold">Liên kết công khai</DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    <div className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 rounded-sm">
                      <a
                        href={`/g/${group.id}/public`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 flex-1 truncate font-medium hover:text-primary"
                      >
                        <Globe className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        <span className="truncate">Cổng thông tin nhóm</span>
                        <ExternalLink className="h-3 w-3 opacity-50 shrink-0 ml-auto" />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 ml-1"
                        title="Sao chép"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(`${window.location.origin}/g/${group.id}/public`);
                          toast({ title: "Đã sao chép link", description: `${window.location.origin}/g/${group.id}/public` });
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 rounded-sm">
                      <a
                        href={`/g/${group.id}/public/pay`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 flex-1 truncate font-medium hover:text-primary"
                      >
                        <CreditCard className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span className="truncate">Trang thanh toán (Pay)</span>
                        <ExternalLink className="h-3 w-3 opacity-50 shrink-0 ml-auto" />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 ml-1"
                        title="Sao chép"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(`${window.location.origin}/g/${group.id}/public/pay`);
                          toast({ title: "Đã sao chép link", description: `${window.location.origin}/g/${group.id}/public/pay` });
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>

                    {groupKindOf(group) === "sports" && (
                      <>
                        <div className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 rounded-sm">
                          <a
                            href={`/g/${group.id}/public/attendance`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 flex-1 truncate font-medium hover:text-primary"
                          >
                            <CalendarCheck className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            <span className="truncate">Điểm danh trận đấu</span>
                            <ExternalLink className="h-3 w-3 opacity-50 shrink-0 ml-auto" />
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 ml-1"
                            title="Sao chép"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(`${window.location.origin}/g/${group.id}/public/attendance`);
                              toast({ title: "Đã sao chép link", description: `${window.location.origin}/g/${group.id}/public/attendance` });
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>

                        <div className="flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 rounded-sm">
                          <a
                            href={`/g/${group.id}/public/ratings`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 flex-1 truncate font-medium hover:text-primary"
                          >
                            <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                            <span className="truncate">Bảng xếp hạng / Ratings</span>
                            <ExternalLink className="h-3 w-3 opacity-50 shrink-0 ml-auto" />
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 ml-1"
                            title="Sao chép"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(`${window.location.origin}/g/${group.id}/public/ratings`);
                              toast({ title: "Đã sao chép link", description: `${window.location.origin}/g/${group.id}/public/ratings` });
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              {isTestGroup(group) && (
                <Badge
                  variant="outline"
                  className="text-[11px] font-normal border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                >
                  Thử nghiệm
                </Badge>
              )}
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
                {groupKindOf(group) === "shared_bills" ? "Chia tiền" : SPORT_LABELS[group.sport || "other"]}
              </span>
              {isOwnerOrSuper && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground rounded-full"
                      onClick={(e) => e.stopPropagation()}
                      title="Tùy chọn nhóm"
                    >
                      <MoreVertical className="h-4 w-4" />
                      <span className="sr-only">Tùy chọn nhóm</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`${window.location.origin}/g/${group.id}/public`, "_blank");
                      }}
                      className="cursor-pointer gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span>Mở trang công khai</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(`${window.location.origin}/g/${group.id}/public`);
                        toast({ title: "Đã sao chép link công khai", description: `${window.location.origin}/g/${group.id}/public` });
                      }}
                      className="cursor-pointer gap-2"
                    >
                      <Copy className="h-4 w-4" />
                      <span>Sao chép link công khai</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditGroup(group);
                      }}
                      className="cursor-pointer gap-2"
                    >
                      <Pencil className="h-4 w-4" />
                      <span>Chỉnh sửa thông tin</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleTestGroup(group);
                      }}
                      className="cursor-pointer gap-2"
                    >
                      <FlaskConical className="h-4 w-4 text-amber-500" />
                      <span>{isTestGroup(group) ? "Bỏ đánh dấu thử nghiệm" : "Đánh dấu là nhóm test"}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        openCoManagers(group);
                      }}
                      className="cursor-pointer gap-2"
                    >
                      <Users className="h-4 w-4" />
                      <span>Phân quyền đồng quản lý</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setGroupToDelete(group);
                      }}
                      className="text-destructive focus:text-destructive cursor-pointer gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Xóa nhóm</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-1 text-sm border-t pt-2.5">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>Vai trò của bạn:</span>
              <span className="font-semibold text-foreground">
                {group.role === "super_admin"
                  ? "Super Admin (Nền tảng)"
                  : group.role === "owner"
                    ? "Chủ nhóm (Owner)"
                    : group.role === "manager"
                      ? "Quản lý"
                      : "Quản trị viên"}
              </span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>Chủ nhóm:</span>
              <span className="font-medium text-foreground truncate max-w-[150px]" title={group.ownerDisplayName || group.ownerEmail || ""}>
                {group.ownerDisplayName || group.ownerEmail || (group.ownerUid ? "Chủ nhóm" : "Hệ thống")}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
            <span className="text-[11px]">Nhấn để vào quản lý</span>
            <span className="inline-flex items-center font-medium text-primary group-hover:translate-x-0.5 transition-transform">
              Mở nhóm <ArrowRight className="h-3 w-3 ml-1" />
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <main className="container max-w-5xl py-8 space-y-6">
      {/* Mobile Drawer Navigation */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[300px] sm:w-[350px] p-0 flex flex-col h-full">
          <SheetHeader className="p-4 border-b text-left">
            <div className="flex items-center gap-3">
              <img src="/pwa-192x192.png" alt="Bún Pay" className="h-10 w-10 rounded-xl object-cover shadow-xs shrink-0" />
              <div className="min-w-0">
                <SheetTitle className="text-base font-bold truncate">Bún Pay Platform</SheetTitle>
                <p className="text-xs text-muted-foreground truncate">
                  {account?.displayName || user?.displayName || "Tài khoản"}
                </p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t flex items-center justify-between text-xs">
              <span className="text-muted-foreground truncate max-w-[170px]">{account?.email || user?.email}</span>
              <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                {account?.role === "owner" ? "👑 Owner" : "Quản lý"}
              </Badge>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
            {/* THAO TÁC CHÍNH */}
            <div className="space-y-1">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Thao tác chính
              </p>
              <Button
                variant="outline"
                className="w-full justify-start gap-2.5 h-9 text-xs"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setName("");
                  setSlug("");
                  setSlugManuallyEdited(false);
                  setSport("");
                  setKind("sports");
                  setIsTest(false);
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4 text-primary" />
                <span>Tạo nhóm mới</span>
              </Button>

              {account && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2.5 h-9 text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openSettlementOverview();
                  }}
                >
                  <CreditCard className="h-4 w-4 text-emerald-600" />
                  <span className="truncate">
                    {account?.role === "owner" ? "Đối soát hoàn tiền nền tảng" : "Đối soát & Theo dõi hoàn tiền"}
                  </span>
                </Button>
              )}

              {account?.role === "owner" && (
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2.5 h-9 text-xs"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate("/platform/accounts");
                  }}
                >
                  <Users className="h-4 w-4 text-blue-600" />
                  <span>Quản lý Tài khoản (Owner)</span>
                </Button>
              )}
            </div>

            {/* BỘ LỌC NHÓM */}
            <div className="space-y-1 border-t pt-3">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Bộ lọc danh sách nhóm
              </p>
              <button
                type="button"
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                  activeCategory === "all" ? "bg-muted font-semibold text-primary" : "text-muted-foreground hover:bg-muted/60"
                }`}
                onClick={() => {
                  setActiveCategory("all");
                  setMobileMenuOpen(false);
                }}
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="h-4 w-4" />
                  <span>Tất cả nhóm</span>
                </div>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{groups.length}</Badge>
              </button>

              <button
                type="button"
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                  activeCategory === "sports" ? "bg-muted font-semibold text-primary" : "text-muted-foreground hover:bg-muted/60"
                }`}
                onClick={() => {
                  setActiveCategory("sports");
                  setMobileMenuOpen(false);
                }}
              >
                <div className="flex items-center gap-2.5">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <span>Nhóm Thể thao</span>
                </div>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{sportGroups.length}</Badge>
              </button>

              <button
                type="button"
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                  activeCategory === "shared_bills" ? "bg-muted font-semibold text-primary" : "text-muted-foreground hover:bg-muted/60"
                }`}
                onClick={() => {
                  setActiveCategory("shared_bills");
                  setMobileMenuOpen(false);
                }}
              >
                <div className="flex items-center gap-2.5">
                  <Receipt className="h-4 w-4 text-emerald-500" />
                  <span>Quỹ chung / Chi tiêu</span>
                </div>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{sharedBillGroups.length}</Badge>
              </button>
            </div>

            {/* VÀO NHANH NHÓM */}
            {groups.length > 0 && (
              <div className="space-y-1 border-t pt-3">
                <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  Vào nhanh nhóm
                </p>
                <div className="space-y-0.5 max-h-[220px] overflow-y-auto pr-1">
                  {groups.slice(0, 12).map((g) => {
                    const isShared = groupKindOf(g) === "shared_bills";
                    const isTest = isTestGroup(g);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          try {
                            localStorage.setItem("lastActiveGroupId", g.id);
                          } catch {}
                          navigate(`/g/${g.id}/admin`);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors text-left"
                      >
                        <div className="min-w-0 flex-1 mr-2">
                          <p className="font-medium truncate text-foreground">{g.name}</p>
                          <p className="text-[10px] text-muted-foreground/80 truncate">@{g.id}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isTest && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/40 text-amber-600 bg-amber-500/10">
                              Test
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {isShared ? "Chia tiền" : g.sport ? SPORT_LABELS[g.sport as GroupSport] || g.sport : "Thể thao"}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer: Sign out */}
          <div className="p-3 border-t bg-muted/20">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 h-9"
              onClick={async () => {
                setMobileMenuOpen(false);
                await signOut(auth);
                navigate("/platform/login");
              }}
            >
              <LogOut className="h-4 w-4" />
              <span>Đăng xuất</span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground"
            aria-label="Mở menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <img src="/pwa-192x192.png" alt="Bún Pay" className="h-11 w-11 rounded-2xl object-cover shadow-sm shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Quản lý Nhóm</h1>
            <div className="flex items-center gap-2 mt-0.5 sm:mt-1 flex-wrap">
              <span className="text-xs sm:text-sm font-medium text-foreground">
                {account?.displayName || user?.displayName || "Tài khoản"}
              </span>
              <span className="text-[11px] sm:text-xs text-muted-foreground hidden sm:inline">({account?.email || user?.email})</span>
              <Badge variant="outline" className="text-[10px] sm:text-[11px] font-normal">
                {account?.role === "owner" ? "Chủ nền tảng (Owner)" : "Quản lý"}
              </Badge>
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-2 sm:gap-2.5" aria-label="Thao tác nhanh">
          {account && (
            <Button
              variant="outline"
              onClick={openSettlementOverview}
              className="hidden sm:inline-flex gap-2 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
            >
              <CreditCard className="h-4 w-4" />
              <span className="hidden lg:inline">
                {account?.role === "owner" ? "Đối soát hoàn tiền nền tảng" : "Đối soát & Theo dõi hoàn tiền"}
              </span>
              <span className="lg:hidden">Đối soát</span>
            </Button>
          )}

          <Button
            onClick={() => {
              setName("");
              setSlug("");
              setSlugManuallyEdited(false);
              setSport("");
              setKind("sports");
              setIsTest(false);
              setOpen(true);
            }}
            className="hidden sm:inline-flex gap-1.5 shadow-xs"
          >
            <Plus className="h-4 w-4" />
            <span>Tạo nhóm mới</span>
          </Button>

          {/* User Profile & Account Dropdown Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0 hover:bg-muted focus-visible:ring-2">
                <Avatar className="h-9 w-9 border border-border">
                  <AvatarFallback className="bg-primary/10 text-primary font-bold">
                    {(account?.displayName || user?.displayName || account?.email || "U")
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {account?.displayName || user?.displayName || "Tài khoản"}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground truncate">
                    {account?.email || user?.email}
                  </p>
                  <span className="text-[11px] text-primary font-medium mt-1">
                    {account?.role === "owner" ? "👑 Chủ nền tảng (Owner)" : "Quản lý"}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {account?.role === "owner" && (
                <DropdownMenuItem asChild>
                  <Link to="/platform/accounts" className="cursor-pointer gap-2 flex items-center">
                    <Users className="h-4 w-4" />
                    <span>Quản lý Tài khoản</span>
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer gap-2 flex items-center"
                onClick={async () => {
                  await signOut(auth);
                  navigate("/platform/login");
                }}
              >
                <LogOut className="h-4 w-4" />
                <span>Đăng xuất</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </header>

      {/* Filter / Search Bar */}
      {!loading && !error && groups.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-lg w-fit">
            <Button
              variant={activeCategory === "all" ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-8 gap-1.5 font-medium"
              onClick={() => setActiveCategory("all")}
            >
              <Layers className="h-3.5 w-3.5" />
              Tất cả
              <span className="ml-1 rounded-full bg-background px-1.5 py-0.2 text-[11px] font-semibold">
                {groups.length}
              </span>
            </Button>
            <Button
              variant={activeCategory === "sports" ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-8 gap-1.5 font-medium"
              onClick={() => setActiveCategory("sports")}
            >
              <Trophy className="h-3.5 w-3.5 text-amber-500" />
              Thể thao
              <span className="ml-1 rounded-full bg-background px-1.5 py-0.2 text-[11px] font-semibold">
                {groups.filter((g) => groupKindOf(g) !== "shared_bills").length}
              </span>
            </Button>
            <Button
              variant={activeCategory === "shared_bills" ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-8 gap-1.5 font-medium"
              onClick={() => setActiveCategory("shared_bills")}
            >
              <Receipt className="h-3.5 w-3.5 text-blue-500" />
              Chia tiền định kỳ
              <span className="ml-1 rounded-full bg-background px-1.5 py-0.2 text-[11px] font-semibold">
                {groups.filter((g) => groupKindOf(g) === "shared_bills").length}
              </span>
            </Button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm nhóm..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p role="alert">Không thể tải nhóm. Vui lòng tải lại trang.</p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Bạn chưa có nhóm nào. Bấm &quot;Tạo nhóm mới&quot; để bắt đầu.
        </p>
      ) : (
        <div className="space-y-8">
          {/* SECTION 1: Nhóm Thể thao */}
          {(activeCategory === "all" || activeCategory === "sports") && (
            <section className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Trophy className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold tracking-tight">Nhóm Thể thao</h2>
                      <Badge variant="secondary" className="text-xs font-medium">
                        {sportGroups.length} nhóm
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Bóng đá, Cầu lông và các hoạt động thể thao chia tiền theo trận
                    </p>
                  </div>
                </div>
                {activeCategory === "sports" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 gap-1.5"
                    onClick={() => {
                      setName("");
                      setSlug("");
                      setSlugManuallyEdited(false);
                      setSport("");
                      setKind("sports");
                      setIsTest(false);
                      setOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Tạo nhóm thể thao
                  </Button>
                )}
              </div>

              {sportGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {searchQuery ? "Không tìm thấy nhóm thể thao nào phù hợp." : "Chưa có nhóm thể thao nào."}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sportGroups.map((group) => renderGroupCard(group))}
                </div>
              )}
            </section>
          )}

          {/* SECTION 2: Nhóm Chia tiền định kỳ (Shared Bills) */}
          {(activeCategory === "all" || activeCategory === "shared_bills") && (
            <section className={`space-y-3.5 ${activeCategory === "all" ? "pt-6 border-t" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold tracking-tight">Nhóm Chia tiền định kỳ (Shared Bills)</h2>
                      <Badge variant="secondary" className="text-xs font-medium">
                        {sharedBillGroups.length} nhóm
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Netflix, Spotify, sinh hoạt dùng chung và thu chi định kỳ
                    </p>
                  </div>
                </div>
                {activeCategory === "shared_bills" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 gap-1.5"
                    onClick={() => {
                      setName("");
                      setSlug("");
                      setSlugManuallyEdited(false);
                      setSport("");
                      setKind("shared_bills");
                      setIsTest(false);
                      setOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Tạo nhóm chia tiền
                  </Button>
                )}
              </div>

              {sharedBillGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {searchQuery ? "Không tìm thấy nhóm chia tiền nào phù hợp." : "Chưa có nhóm chia tiền định kỳ nào."}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sharedBillGroups.map((group) => renderGroupCard(group))}
                </div>
              )}
            </section>
          )}

          {/* SECTION 3: Nhóm Thử Nghiệm (Test Groups) - Collapsible */}
          {displayedTestGroups.length > 0 && (
            <section className="pt-6 border-t space-y-3.5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsTestSectionOpen((prev) => !prev)}
                  className="flex items-center gap-2.5 text-left group/btn hover:opacity-80 transition-opacity"
                >
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <FlaskConical className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold tracking-tight">Nhóm Thử Nghiệm (Test)</h2>
                      <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium">
                        {displayedTestGroups.length} nhóm
                      </Badge>
                      {isTestSectionVisible ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Các nhóm thử nghiệm được gom lại ở đây để giảm sự ưu tiên và không làm phân tâm các nhóm chính
                    </p>
                  </div>
                </button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground gap-1"
                  onClick={() => setIsTestSectionOpen((prev) => !prev)}
                >
                  {isTestSectionVisible ? "Thu gọn" : "Mở rộng danh sách"}
                </Button>
              </div>

              {isTestSectionVisible && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-2">
                  {displayedTestGroups.map((group) => renderGroupCard(group))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Dialog Tạo Nhóm */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo nhóm mới</DialogTitle>
            <DialogDescription>Nhập thông tin nhóm, môn thể thao và mã đường dẫn URL.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div>
              <Label htmlFor="group-name">Tên nhóm</Label>
              <Input
                id="group-name"
                required
                minLength={2}
                maxLength={60}
                placeholder="VD: Cầu Lông Cuối Tuần"
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="group-slug">Mã đường dẫn nhóm (URL Slug)</Label>
              <Input
                id="group-slug"
                placeholder="VD: cau-long-cuoi-tuan"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setSlugManuallyEdited(true);
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Link truy cập: <span className="font-mono text-foreground font-medium">/g/{slug || "slug-nhom"}</span>
              </p>
            </div>

            <div><Label htmlFor="group-kind">Loại nhóm</Label><Select value={kind} onValueChange={(value: GroupKind) => setKind(value)}><SelectTrigger id="group-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sports">Thể thao</SelectItem><SelectItem value="shared_bills">Chia tiền và thu định kỳ</SelectItem></SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">Chọn chia tiền cho Netflix, dịch vụ định kỳ và các chi phí dùng chung. Không thể đổi loại nhóm sau khi tạo.</p></div>
            {kind === "sports" && <div>
              <Label htmlFor="group-sport">Môn thể thao</Label>
              <Select value={sport} onValueChange={(value: GroupSport) => setSport(value)} required>
                <SelectTrigger id="group-sport">
                  <SelectValue placeholder="Chọn môn thể thao" />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_SPORTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {SPORT_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>}

            <div className="flex items-start space-x-2 pt-2 border-t">
              <Checkbox
                id="auto-add-member"
                checked={autoAddMeMember}
                onCheckedChange={(checked) => setAutoAddMeMember(!!checked)}
                className="mt-0.5"
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="auto-add-member" className="text-xs font-medium cursor-pointer">
                  Tự động thêm tôi làm thành viên trong nhóm này
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Tạo hồ sơ thành viên gắn liền với tài khoản của bạn để dễ dàng điểm danh và tự động theo dõi tiền hoàn khi ứng tiền sân.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-2 pt-2 border-t">
              <Checkbox
                id="is-test-group"
                checked={isTest}
                onCheckedChange={(checked) => setIsTest(!!checked)}
                className="mt-0.5"
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="is-test-group" className="text-xs font-medium cursor-pointer">
                  Đánh dấu đây là nhóm thử nghiệm (Test group)
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Nhóm thử nghiệm sẽ được gom ở cuối trang và tách biệt khỏi các nhóm chính thức.
                </p>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                Hủy
              </Button>
              <Button disabled={busy || (kind === "sports" && !sport) || name.trim().length < 2} type="submit">
                {busy ? "Đang tạo…" : "Tạo nhóm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Phân Quyền Đồng Quản Lý */}
      <Dialog open={!!selectedGroupForManagers} onOpenChange={(isOpen) => !isOpen && setSelectedGroupForManagers(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Đồng quản lý: {selectedGroupForManagers?.name}
            </DialogTitle>
            <DialogDescription>
              Thêm tài khoản đồng quản lý để cùng quản lý trận đấu và điểm danh.
            </DialogDescription>
          </DialogHeader>

          {/* Thông tin Chủ nhóm (Owner) */}
          <div className="p-3.5 rounded-lg border bg-amber-500/10 border-amber-500/30">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
                  <span className="text-base">👑</span>
                  <span>{selectedGroupForManagers?.ownerDisplayName || coManagers.find((m) => m.isOwner)?.displayName || "Chủ nhóm"}</span>
                  <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium">
                    Chủ nhóm (Owner)
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedGroupForManagers?.ownerEmail || coManagers.find((m) => m.isOwner)?.email || "Chưa có email"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground italic">Người tạo nhóm</span>
            </div>
          </div>

          <form onSubmit={handleAddCoManager} className="space-y-2.5 pt-2">
            <Label htmlFor="manager-email">Thêm đồng quản lý mới</Label>
            <div className="flex gap-2">
              <Input
                id="manager-email"
                type="email"
                placeholder="Nhập email tài khoản cần thêm..."
                value={newManagerEmail}
                onChange={(e) => setNewManagerEmail(e.target.value)}
                required
              />
              <Button type="submit" disabled={addingManager || !newManagerEmail.trim()} className="gap-1.5 shrink-0">
                {addingManager ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    <span>Thêm</span>
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Đồng quản lý có toàn quyền tạo trận, chốt danh sách và điểm danh trận đấu cùng chủ nhóm.
            </p>
          </form>

          <div className="border-t pt-3 mt-1">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Danh sách Đồng quản lý ({coManagers.filter((m) => !m.isOwner && m.uid !== selectedGroupForManagers?.ownerUid).length})
            </h4>
            {loadingManagers ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : coManagers.filter((m) => !m.isOwner && m.uid !== selectedGroupForManagers?.ownerUid).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 bg-muted/30 rounded-md">
                Chưa có đồng quản lý nào.
              </p>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {coManagers
                  .filter((m) => !m.isOwner && m.uid !== selectedGroupForManagers?.ownerUid)
                  .map((m) => (
                    <div key={m.uid} className="flex items-center justify-between p-2.5 rounded-md bg-muted/50 text-sm">
                      <div>
                        <p className="font-medium text-foreground">{m.displayName || m.email}</p>
                        <p className="text-xs text-muted-foreground">{m.email} · Đồng quản lý</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveCoManager(m.uid)}
                        title="Gỡ quyền đồng quản lý"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Sửa Nhóm */}
      <Dialog open={!!editGroup} onOpenChange={(isOpen) => !isOpen && setEditGroup(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa thông tin nhóm</DialogTitle>
            <DialogDescription>
              Cập nhật tên hiển thị, bộ môn hoặc kiểm tra đường dẫn URL hiện tại của nhóm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="edit-name">Tên nhóm</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="VD: Cầu Lông Zigvy"
              />
            </div>

            {groupKindOf(editGroup) === "sports" && <div>
              <Label htmlFor="edit-sport">Môn thể thao</Label>
              <Select value={editSport} onValueChange={(val: any) => setEditSport(val)}>
                <SelectTrigger id="edit-sport">
                  <SelectValue placeholder="Chọn môn" />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_SPORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SPORT_LABELS[s] || s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>}

            <div className="p-3 bg-muted/40 rounded-lg space-y-1.5 text-xs">
              <span className="font-semibold text-foreground">Đường dẫn nhóm (Path ID):</span>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={`/g/${editGroup?.id}`}
                  className="h-8 font-mono text-xs bg-background"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title="Sao chép đường dẫn"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/g/${editGroup?.id}`);
                    toast({ title: "Đã sao chép đường link nhóm" });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-muted-foreground text-[11px]">
                Đường dẫn này được dùng cho các link công khai, bảng xếp hạng và điểm danh của nhóm.
              </p>
            </div>

            <div className="flex items-start space-x-2 pt-2 border-t">
              <Checkbox
                id="edit-is-test-group"
                checked={editIsTest}
                onCheckedChange={(checked) => setEditIsTest(!!checked)}
                className="mt-0.5"
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="edit-is-test-group" className="text-xs font-medium cursor-pointer">
                  Đánh dấu là nhóm thử nghiệm (Test group)
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Xếp vào mục nhóm thử nghiệm ở cuối trang để tránh nhầm lẫn với các nhóm hoạt động thực tế.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroup(null)} disabled={savingEdit}>
              Hủy
            </Button>
            <Button onClick={handleSaveEditGroup} disabled={savingEdit || !editName.trim() || (groupKindOf(editGroup) === "sports" && !editSport)}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Lưu thay đổi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Đối soát Hoàn tiền Toàn nền tảng (Super Admin) */}
      <Dialog open={settlementOpen} onOpenChange={setSettlementOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" />
              <DialogTitle>
                {settlementData?.isSuperAdmin
                  ? "Đối soát Hoàn tiền Nền tảng (Super Admin)"
                  : "Đối soát & Theo dõi Hoàn tiền (Quản lý nhóm)"}
              </DialogTitle>
            </div>
            <DialogDescription>
              {settlementData?.isSuperAdmin
                ? "Quản lý tổng tiền sân PayOS đã thu từ các nhóm và hoàn trả lại tiền cho người quản lý từng nhóm."
                : "Theo dõi tiền bạn đã ứng đang đợi Super Admin hoàn lại, và các khoản cần hoàn tiền cho thành viên trong các nhóm bạn quản lý."}
            </DialogDescription>
          </DialogHeader>

          {settlementLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : settlementData ? (
            <Tabs value={settlementTab} onValueChange={(v: any) => { setSettlementTab(v); if (v === "history") fetchSettlementHistory(); }} className="w-full">
              <TabsList className="grid grid-cols-2 mb-3">
                <TabsTrigger value="pending">
                  Chờ hoàn tiền ({settlementData?.summary?.pendingMatchesCount || 0})
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Lịch sử đã hoàn ({settlementHistory?.length || 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="space-y-6 py-1 mt-0">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {settlementData.isSuperAdmin ? (
                  <>
                    <Card className="p-3 bg-emerald-500/10 border-emerald-500/20 shadow-xs">
                      <p className="text-xs text-muted-foreground">Tổng tiền cần hoàn:</p>
                      <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                        {settlementData.summary?.totalPendingAmount?.toLocaleString() || 0} VND
                      </p>
                    </Card>
                    <Card className="p-3 bg-muted/40 shadow-xs">
                      <p className="text-xs text-muted-foreground">Nhóm chờ hoàn tiền:</p>
                      <p className="text-xl font-bold text-foreground">
                        {settlementData.summary?.pendingGroupsCount || 0} nhóm
                      </p>
                    </Card>
                    <Card className="p-3 bg-muted/40 shadow-xs">
                      <p className="text-xs text-muted-foreground">Tổng số trận chờ hoàn:</p>
                      <p className="text-xl font-bold text-foreground">
                        {settlementData.summary?.pendingMatchesCount || 0} trận
                      </p>
                    </Card>
                  </>
                ) : (
                  <>
                    <Card className="p-3 bg-amber-500/10 border-amber-500/20 shadow-xs">
                      <p className="text-xs text-muted-foreground">Tiền đợi Super Admin hoàn lại:</p>
                      <p className="text-xl font-bold text-amber-700 dark:text-amber-400">
                        {settlementData.summary?.waitingForSuperAdminAmount?.toLocaleString() || 0} VND
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {settlementData.summary?.waitingForSuperAdminCount || 0} trận bạn tự ứng
                      </p>
                    </Card>
                    <Card className="p-3 bg-emerald-500/10 border-emerald-500/20 shadow-xs">
                      <p className="text-xs text-muted-foreground">Tiền cần hoàn cho thành viên:</p>
                      <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                        {settlementData.summary?.totalPendingAmount?.toLocaleString() || 0} VND
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {settlementData.summary?.pendingMatchesCount || 0} trận trong nhóm bạn quản lý
                      </p>
                    </Card>
                    <Card className="p-3 bg-muted/40 shadow-xs">
                      <p className="text-xs text-muted-foreground">Nhóm bạn quản lý:</p>
                      <p className="text-xl font-bold text-foreground">
                        {settlementData.groups?.length || 0} nhóm
                      </p>
                    </Card>
                  </>
                )}
              </div>

              {/* Action: Clear Historical Backlog (Super Admin only) */}
              {settlementData.isSuperAdmin && (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-foreground">Dọn dẹp các trận đấu cũ</p>
                    <p className="text-[11px] text-muted-foreground">
                      Đánh dấu tất cả các trận đấu trước hôm nay ở mọi nhóm là đã hoàn tất đối soát.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSettleAllPast}
                    disabled={settlingAllPast}
                    className="shrink-0 text-xs gap-1.5"
                  >
                    {settlingAllPast ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                    Hoàn tiền nhanh các trận cũ
                  </Button>
                </div>
              )}

              {/* Waiting for Super Admin List (For Managers) */}
              {!settlementData.isSuperAdmin && (settlementData.waitingForSuperAdmin?.length > 0 ? (
                <div className="border border-amber-300 dark:border-amber-800 rounded-lg p-4 bg-amber-50/20 dark:bg-amber-950/20 space-y-3">
                  <div className="flex items-center justify-between border-b border-amber-200 dark:border-amber-900 pb-2">
                    <div>
                      <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
                        ⏳ Tiền bạn đã ứng đang đợi Super Admin hoàn lại
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Các trận bạn đứng ra ứng tiền sân ở các nhóm, tiền thu qua PayOS đang chờ Super Admin chuyển hoàn cho bạn.
                      </p>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {settlementData.summary?.waitingForSuperAdminAmount?.toLocaleString()} VND
                    </span>
                  </div>

                  <div className="divide-y divide-amber-200/50 dark:divide-amber-900/50">
                    {settlementData.waitingForSuperAdmin.map((m: any) => (
                      <div key={m.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[10px] bg-background">{m.groupName}</Badge>
                          <span className="font-semibold text-foreground">
                            📅 {m.date ? new Date(m.date).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Trận đấu"}
                          </span>
                          {m.venueName && <span className="text-muted-foreground">• {m.venueName}</span>}
                          {m.isFullyCollected ? (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Đã thu đủ qua PayOS ({m.collectedAmount?.toLocaleString()}đ)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Mới thu {m.collectedAmount?.toLocaleString()} / {m.totalAmount?.toLocaleString()}đ
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <strong className="text-amber-600 dark:text-amber-400 font-bold">{m.totalAmount?.toLocaleString()} VND</strong>
                          <span className="text-[10px] text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded font-medium">
                            Chờ Super Admin chuyển khoản
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : !settlementData.isSuperAdmin ? (
                <div className="p-3 text-xs text-muted-foreground rounded-lg border border-dashed bg-muted/10 space-y-1">
                  <p className="text-center font-medium">🎉 Bạn hiện không có trận nào tự ứng tiền đang chờ Super Admin hoàn lại.</p>
                  <p className="text-[11px] text-center text-muted-foreground/80">
                    💡 Mẹo: Nếu bạn có ứng tiền sân ở các nhóm, hãy vào mục <strong>&ldquo;Thành viên&rdquo;</strong> của nhóm đó và bấm <strong>&ldquo;⭐ Tôi là thành viên này&rdquo;</strong> để hệ thống tự động nhận diện và tính tiền hoàn cho bạn tại đây!
                  </p>
                </div>
              ) : null)}

              {/* Groups List */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {settlementData.isSuperAdmin
                    ? "Danh sách nhóm cần đối soát:"
                    : "Các khoản cần hoàn tiền cho thành viên trong nhóm bạn quản lý:"}
                </h3>
                {settlementData.groups?.filter((g: any) => g.pendingCount > 0).length === 0 ? (
                  <p className="text-center p-6 text-xs text-muted-foreground border border-dashed rounded-lg">
                    🎉 Tuyệt vời! Hiện không có trận nào của thành viên cần hoàn tiền sân.
                  </p>
                ) : (
                  settlementData.groups
                    ?.filter((g: any) => g.pendingCount > 0)
                    .map((item: any) => {
                      const payerGroups = item.payerGroups || (() => {
                        const map = new Map();
                        (item.pendingMatches || []).forEach((m: any) => {
                          const key = m.paidByMemberId || `mgr_${item.groupId}`;
                          if (!map.has(key)) {
                            map.set(key, {
                              payerId: m.paidByMemberId || null,
                              payerName: m.paidByMemberName || item.managerName || "Quản lý nhóm",
                              isManager: m.isManagerPayer ?? !m.paidByMemberId,
                              totalAmount: 0,
                              matches: [],
                            });
                          }
                          const g = map.get(key);
                          g.totalAmount += (Number(m.totalAmount) || 0);
                          g.matches.push(m);
                        });
                        return Array.from(map.values());
                      })();

                      return (
                        <Card key={item.groupId} className="p-4 space-y-3.5 shadow-xs">
                          {/* Group Header */}
                          <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
                            <div>
                              <h4 className="font-bold text-base text-foreground">{item.groupName}</h4>
                              <p className="text-xs text-muted-foreground">
                                Quản lý nhóm: <strong>{item.managerName}</strong> {item.managerEmail ? `(${item.managerEmail})` : ""}
                              </p>
                            </div>
                            <div className="text-right flex items-center gap-2.5">
                              <div>
                                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 block">
                                  {item.pendingAmount?.toLocaleString()} VND
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {item.pendingCount} trận chờ hoàn
                                </span>
                              </div>
                              {payerGroups.filter((pg: any) => !pg.isOwner).length > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 gap-1"
                                  disabled={batchSettlingGid === item.groupId}
                                  onClick={() => handleBatchSettleGroup(item)}
                                >
                                  {batchSettlingGid === item.groupId ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                  )}
                                  Hoàn tất cả nhóm
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Grouped by Member / Payer */}
                          {(() => {
                            const regularPayerGroups = payerGroups.filter((pg: any) => !pg.isOwner);
                            const ownerPayerGroups = payerGroups.filter((pg: any) => pg.isOwner);
                            const totalOwnerMatches = ownerPayerGroups.reduce((sum: number, pg: any) => sum + (pg.matches?.length || 0), 0);

                            return (
                              <div className="space-y-3">
                                {regularPayerGroups.length === 0 && ownerPayerGroups.length > 0 && !showOwnerMatches ? (
                                  <div className="p-3 text-xs text-muted-foreground text-center rounded-lg border border-dashed bg-muted/10">
                                    🎉 Nhóm này không có trận nào của thành viên khác cần hoàn tiền. (Các trận còn lại do bạn tự ứng).
                                  </div>
                                ) : null}

                                {/* 1. Regular Payers needing reimbursement */}
                                {regularPayerGroups.map((payerGroup: any, pIdx: number) => (
                                  <div
                                    key={pIdx}
                                    className="rounded-lg border border-border/70 bg-muted/20 overflow-hidden"
                                  >
                                    {/* Payer Header */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Badge
                                          variant="outline"
                                          className={`text-xs px-2 py-0.5 font-medium ${
                                            payerGroup.isManager
                                              ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
                                              : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                                          }`}
                                        >
                                          👤 Người ứng: {payerGroup.payerName}
                                          {payerGroup.isManager ? " (Quản lý nhóm)" : " (Thành viên)"}
                                        </Badge>
                                      </div>

                                      <div className="flex items-center gap-2 text-xs">
                                        <span className="text-muted-foreground">
                                          {payerGroup.matches?.length || 0} trận:
                                        </span>
                                        <strong className="text-emerald-600 dark:text-emerald-400 font-bold">
                                          {payerGroup.totalAmount?.toLocaleString()} VND
                                        </strong>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 text-[11px] px-2 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 gap-1 font-medium"
                                          disabled={settlingPayerKey === `${item.groupId}_${payerGroup.payerName}`}
                                          onClick={() => handleSettlePayerMatches(item.groupId, payerGroup.payerName, payerGroup.matches)}
                                        >
                                          {settlingPayerKey === `${item.groupId}_${payerGroup.payerName}` ? (
                                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                          ) : (
                                            <Check className="h-3 w-3 mr-1" />
                                          )}
                                          Đã hoàn tất cả ({payerGroup.matches?.length || 0} trận)
                                        </Button>
                                      </div>
                                    </div>

                                    {/* Matches List for this Payer */}
                                    <div className="divide-y divide-border/50">
                                      {payerGroup.matches?.map((match: any) => {
                                        const matchDate = match.date ? new Date(match.date) : null;
                                        const dateFormatted = matchDate && !isNaN(matchDate.getTime())
                                          ? matchDate.toLocaleDateString("vi-VN", {
                                              weekday: "short",
                                              day: "2-digit",
                                              month: "2-digit",
                                              year: "numeric",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            })
                                          : (match.date || "Trận đấu");

                                        return (
                                          <div
                                            key={match.id}
                                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
                                          >
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="font-semibold text-foreground">
                                                📅 {dateFormatted}
                                              </span>
                                              {match.venueName && (
                                                <span className="text-muted-foreground">
                                                  • {match.venueName}
                                                </span>
                                              )}
                                              {/* Collection Progress Badge */}
                                              {match.isFullyCollected ? (
                                                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                  Đã thu đủ ({match.collectedAmount?.toLocaleString()}đ)
                                                </span>
                                              ) : match.collectedAmount > 0 ? (
                                                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                  Mới thu {match.collectedAmount?.toLocaleString()} / {match.totalAmount?.toLocaleString()}đ (còn {match.pendingSharesCount} người)
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                                  Chưa thu được tiền (0đ)
                                                </span>
                                              )}
                                            </div>

                                            <div className="flex flex-col sm:items-end justify-center gap-1 shrink-0">
                                              <div className="flex items-center gap-2">
                                                {match.payerShareAmount > 0 && !match.payerSharePaid && (
                                                  <span className="text-[11px] text-muted-foreground line-through">
                                                    {(match.grossAmount ?? match.totalAmount)?.toLocaleString()}đ
                                                  </span>
                                                )}
                                                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                                  {(match.netPayoutAmount ?? match.totalAmount)?.toLocaleString()} VND
                                                </span>
                                              </div>
                                              {match.payerShareAmount > 0 && (
                                                <div className="text-[10px]">
                                                  {match.payerSharePaid ? (
                                                    <span className="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                                      Phần người ứng: {match.payerShareAmount?.toLocaleString()}đ (Đã nộp PayOS)
                                                    </span>
                                                  ) : (
                                                    <span className="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                                      Trừ phần người ứng: -{match.payerShareAmount?.toLocaleString()}đ
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-6 text-[11px] px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800"
                                                disabled={settlingMatchId === match.id}
                                                onClick={() =>
                                                  handleSettleSingleMatch(
                                                    match,
                                                    item.groupId,
                                                    payerGroup.payerName
                                                  )
                                                }
                                              >
                                                {settlingMatchId === match.id ? (
                                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                                ) : (
                                                  <Check className="h-3 w-3 mr-1" />
                                                )}
                                                Đã hoàn ({(match.netPayoutAmount ?? match.totalAmount)?.toLocaleString()}đ)
                                              </Button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}

                                {/* 2. Owner Payers: Hidden by default, collapsible */}
                                {ownerPayerGroups.length > 0 ? (
                                  <div className="pt-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-[11px] text-muted-foreground hover:text-foreground gap-1.5 px-2"
                                        onClick={() => setShowOwnerMatches((prev) => !prev)}
                                      >
                                        {showOwnerMatches ? (
                                          <>
                                            <ChevronUp className="h-3.5 w-3.5" />
                                            Ẩn {totalOwnerMatches} trận bạn tự ứng (Đã tự giữ tiền PayOS)
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="h-3.5 w-3.5" />
                                            Xem {totalOwnerMatches} trận bạn tự ứng (Đã tự giữ tiền PayOS - Không cần hoàn)
                                          </>
                                        )}
                                      </Button>
                                      {showOwnerMatches && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 text-[10px] text-purple-700 hover:text-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 px-2 font-medium"
                                          onClick={() => handleSettleOwnerMatches(item.groupId, ownerPayerGroups.flatMap((pg: any) => pg.matches || []))}
                                        >
                                          ✓ Hoàn tất đối soát tất cả ({totalOwnerMatches} trận)
                                        </Button>
                                      )}
                                    </div>

                                    {showOwnerMatches && (
                                      <div className="mt-2 space-y-3 opacity-95">
                                        {ownerPayerGroups.map((payerGroup: any, pIdx: number) => (
                                          <div
                                            key={`owner_${pIdx}`}
                                            className="rounded-lg border border-purple-200/80 bg-purple-50/20 dark:border-purple-900/50 dark:bg-purple-950/10 overflow-hidden"
                                          >
                                            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-purple-50/50 dark:bg-purple-950/30 border-b border-purple-200/50">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <Badge
                                                  variant="outline"
                                                  className="text-xs px-2 py-0.5 font-medium bg-purple-100/70 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200"
                                                >
                                                  👤 Người ứng: {payerGroup.payerName} 👑 (Bạn - Super Admin)
                                                </Badge>
                                                <span className="text-[11px] text-muted-foreground italic">
                                                  (Đã tự giữ tiền PayOS - Không cần hoàn)
                                                </span>
                                                {payerGroup.payerId && (
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={linkingMemberId === payerGroup.payerId}
                                                    className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-destructive"
                                                    onClick={() => handleToggleOwnerMember(item.groupId, payerGroup.payerId, false)}
                                                  >
                                                    {linkingMemberId === payerGroup.payerId ? (
                                                      <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                      "Hủy liên kết"
                                                    )}
                                                  </Button>
                                                )}
                                              </div>

                                              <div className="flex items-center gap-2 text-xs">
                                                <span className="text-muted-foreground">
                                                  {payerGroup.matches?.length || 0} trận:
                                                </span>
                                                <strong className="text-slate-400 line-through font-bold">
                                                  {payerGroup.totalAmount?.toLocaleString()} VND
                                                </strong>
                                              </div>
                                            </div>

                                            <div className="divide-y divide-purple-100/60 dark:divide-purple-950/40">
                                              {payerGroup.matches?.map((match: any) => {
                                                const matchDate = match.date ? new Date(match.date) : null;
                                                const dateFormatted = matchDate && !isNaN(matchDate.getTime())
                                                  ? matchDate.toLocaleDateString("vi-VN", {
                                                      weekday: "short",
                                                      day: "2-digit",
                                                      month: "2-digit",
                                                      year: "numeric",
                                                      hour: "2-digit",
                                                      minute: "2-digit",
                                                    })
                                                  : (match.date || "Trận đấu");

                                                return (
                                                  <div
                                                    key={match.id}
                                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-purple-50/30 transition-colors"
                                                  >
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                      <span className="font-semibold text-foreground">
                                                        📅 {dateFormatted}
                                                      </span>
                                                      {match.venueName && (
                                                        <span className="text-muted-foreground">
                                                          • {match.venueName}
                                                        </span>
                                                      )}
                                                      {match.isFullyCollected ? (
                                                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                          Đã thu đủ ({match.collectedAmount?.toLocaleString()}đ)
                                                        </span>
                                                      ) : match.collectedAmount > 0 ? (
                                                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                          Mới thu {match.collectedAmount?.toLocaleString()} / {match.totalAmount?.toLocaleString()}đ (còn {match.pendingSharesCount} người)
                                                        </span>
                                                      ) : (
                                                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                                          Chưa thu được tiền (0đ)
                                                        </span>
                                                      )}
                                                    </div>

                                                    <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                                                      <span className="font-bold text-slate-400 line-through">
                                                        {match.totalAmount?.toLocaleString()} VND
                                                      </span>
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-6 text-[11px] px-2 text-purple-700 hover:text-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/30 border-purple-300 dark:border-purple-800"
                                                        disabled={settlingMatchId === match.id}
                                                        onClick={() =>
                                                          handleSettleSingleMatch(
                                                            match,
                                                            item.groupId,
                                                            payerGroup.payerName
                                                          )
                                                        }
                                                      >
                                                        {settlingMatchId === match.id ? (
                                                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                                        ) : (
                                                          <Check className="h-3 w-3 mr-1" />
                                                        )}
                                                        Đã giữ tiền & Đóng đối soát
                                                      </Button>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}

                          {/* Recipient Account info */}
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-muted/40 p-2.5 rounded-lg">
                            <div>
                              <span className="text-muted-foreground">Tài khoản nhận: </span>
                              {item.payoutRecipient?.accountNumber ? (
                                <strong className="text-foreground">
                                  {item.payoutRecipient.bankName} - {item.payoutRecipient.accountNumber} ({item.payoutRecipient.accountHolder})
                                </strong>
                              ) : (
                                <span className="text-amber-600 italic">Chưa cấu hình tài khoản nhận hoàn tiền</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {item.payoutRecipient?.accountNumber && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => setSelectedGroupQr(item)}
                                >
                                  <QrCode className="h-3.5 w-3.5 text-primary" />
                                  Xem VietQR tổng
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs"
                                disabled={batchSettlingGid === item.groupId || item.pendingCount === 0}
                                onClick={() => handleBatchSettleGroup(item)}
                              >
                                {batchSettlingGid === item.groupId ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                ) : null}
                                Xác nhận đã chuyển tất cả ({item.pendingCount})
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })
                )}
              </div>
              </TabsContent>

              <TabsContent value="history" className="space-y-4 py-1 mt-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Lịch sử các trận đã hoàn tiền đối soát:
                  </h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={fetchSettlementHistory}
                    disabled={historyLoading}
                  >
                    {historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Làm mới
                  </Button>
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : settlementHistory.length === 0 ? (
                  <div className="p-8 text-center border border-dashed rounded-lg bg-muted/10 text-xs text-muted-foreground">
                    Chưa có lịch sử đối soát hoàn tiền nào được ghi nhận.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                    {settlementHistory.map((h: any) => {
                      const pDate = h.paidOutAt ? new Date(h.paidOutAt) : null;
                      const pDateStr = pDate && !isNaN(pDate.getTime())
                        ? pDate.toLocaleDateString("vi-VN", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Không rõ";

                      return (
                        <div
                          key={h.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-card text-xs hover:bg-muted/20 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-[10px] bg-muted/50">{h.groupName}</Badge>
                              <span className="font-semibold text-foreground">
                                📅 {h.date ? new Date(h.date).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }) : "Trận đấu"}
                              </span>
                              {h.venueName && <span className="text-muted-foreground">• {h.venueName}</span>}
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground flex-wrap text-[11px]">
                              <span>
                                👤 Người ứng: <strong>{h.paidByMemberName || h.recipientName || h.paidByName || "Không rõ"}</strong>
                              </span>
                              {h.recipientName && h.recipientName !== (h.paidByMemberName || h.paidByName) && (
                                <span>• Nhận: <strong>{h.recipientName}</strong></span>
                              )}
                              <span>• Lúc: {pDateStr}</span>
                            </div>
                          </div>

                          <div className="text-left sm:text-right shrink-0">
                            <div className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                              {(h.netPayoutAmount ?? h.grossAmount)?.toLocaleString()} VND
                            </div>
                            {h.payerShareAmount > 0 && (
                              <div className="text-[10px] text-muted-foreground">
                                Tiền sân: {h.grossAmount?.toLocaleString()}đ | Trừ phần ứng: -{h.payerShareAmount?.toLocaleString()}đ
                              </div>
                            )}
                            {h.payoutNote && (
                              <p className="text-[10px] text-muted-foreground italic max-w-xs truncate">
                                {h.payoutNote}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog Xem VietQR Tổng cho nhóm */}
      <Dialog open={!!selectedGroupQr} onOpenChange={(open) => !open && setSelectedGroupQr(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quét mã VietQR chuyển tiền cho Quản lý nhóm</DialogTitle>
            <DialogDescription>
              Mã QR đã gắn sẵn tổng số tiền của tất cả các trận chờ hoàn tiền cho nhóm <strong>{selectedGroupQr?.groupName}</strong>.
            </DialogDescription>
          </DialogHeader>

          {selectedGroupQr && (
            <div className="flex flex-col items-center gap-3 p-4 bg-muted/20 border rounded-xl">
              <img
                src={
                  selectedGroupQr.payoutRecipient?.qrCodeUrl ||
                  `https://img.vietqr.io/image/${selectedGroupQr.payoutRecipient?.bankBin}-${selectedGroupQr.payoutRecipient?.accountNumber}-compact.png?amount=${
                    selectedGroupQr.pendingAmount || 0
                  }&addInfo=${encodeURIComponent(
                    `HOAN TIEN SAN ${selectedGroupQr.groupName.slice(0, 15)}`,
                  )}&accountName=${encodeURIComponent(selectedGroupQr.payoutRecipient?.accountHolder || "")}`
                }
                alt="VietQR Payout"
                className="w-52 h-52 object-contain rounded-lg bg-white p-2 border shadow-xs"
              />
              <div className="w-full text-center space-y-1">
                <p className="font-semibold text-foreground text-sm">
                  {selectedGroupQr.payoutRecipient?.bankName}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono font-bold text-lg text-primary">
                    {selectedGroupQr.payoutRecipient?.accountNumber}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Sao chép số tài khoản"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedGroupQr.payoutRecipient?.accountNumber || "");
                      toast({ title: "Đã sao chép số tài khoản" });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground uppercase">
                  {selectedGroupQr.payoutRecipient?.accountHolder}
                </p>
                <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 pt-1">
                  Tổng tiền: {selectedGroupQr.pendingAmount?.toLocaleString()} VND ({selectedGroupQr.pendingCount} trận)
                </p>
              </div>

              <Button
                className="w-full mt-2"
                disabled={batchSettlingGid === selectedGroupQr.groupId}
                onClick={() => handleBatchSettleGroup(selectedGroupQr)}
              >
                {batchSettlingGid === selectedGroupQr.groupId ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                )}
                Xác nhận đã chuyển khoản thành công
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Groups;
