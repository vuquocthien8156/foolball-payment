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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  Trash2,
  Users,
  Loader2,
  DollarSign,
  BadgePercent,
  Pencil,
  ArrowUp,
  UserX,
  CheckSquare,
  Square,
  Repeat,
  X,
  ChevronDown,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  collectionGroup,
  where,
  getDoc,
  orderBy,
  Timestamp,
  writeBatch,
  updateDoc,
  setDoc,
} from "firebase/firestore";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/lib/firebase";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";

// Interfaces
interface Member {
  id: string;
  name: string;
  nickname?: string;
  isExemptFromPayment?: boolean;
  loginEnabled?: boolean;
  authUid?: string;
  loginEmail?: string;
  loginRole?: string;
  adminTabs?: string[];
  autoAttendance?: boolean;
  inactive?: boolean;
  isPriority?: boolean;
}

interface MemberStats {
  totalPaid: number;
}

interface Share {
  id: string;
  memberId: string;
  teamId: string; // Add teamId
  amount: number;
  status: "PAID" | "UNPAID";
  createdAt: Timestamp;
}

interface Match {
  id: string;
  date: Timestamp | string;
  teamNames?: { [key: string]: string }; // Add teamNames
}

interface MemberDetailsProps {
  memberId: string;
}

// MemberDetails Component
const MemberDetails = ({ memberId }: MemberDetailsProps) => {
  const [history, setHistory] = useState<
    { matchDate: Date; share: Share; teamName: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const sharesQuery = query(
          collectionGroup(db, "shares"),
          where("memberId", "==", memberId),
          where("status", "==", "PAID"),
          orderBy("createdAt", "desc")
        );

        const sharesSnapshot = await getDocs(sharesQuery);
        const historyData = await Promise.all(
          sharesSnapshot.docs.map(async (shareDoc) => {
            const share = { id: shareDoc.id, ...shareDoc.data() } as Share;
            // shares collection is a subcollection of a match document
            const matchRef = shareDoc.ref.parent.parent;
            if (!matchRef) return null;

            const matchSnap = await getDoc(matchRef);
            if (!matchSnap.exists()) return null;

            const match = matchSnap.data() as Match;
            const dateValue = match.date;
            if (!dateValue) return null; // Guard against missing date

            const matchDate = (dateValue as Timestamp).toDate
              ? (dateValue as Timestamp).toDate()
              : new Date(dateValue as string);

            if (isNaN(matchDate.getTime())) return null; // Guard against invalid date

            const teamName =
              match.teamNames?.[share.teamId] || `Đội ${share.teamId}`;

            return {
              matchDate,
              share: share,
              teamName,
            };
          })
        );

        setHistory(
          historyData.filter(Boolean) as {
            matchDate: Date;
            share: Share;
            teamName: string;
          }[]
        );
      } catch (error) {
        console.error("Error fetching member history:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Could not fetch member's match history.",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [memberId, toast]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <p className="text-center text-muted-foreground p-8">
        Không có lịch sử thanh toán.
      </p>
    );
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ngày trận đấu</TableHead>
            <TableHead>Tên đội</TableHead>
            <TableHead className="text-right">Số tiền</TableHead>
            <TableHead>Trạng thái</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((item) => (
            <TableRow key={item.share.id}>
              <TableCell>
                {item.matchDate.toLocaleDateString("vi-VN")}
              </TableCell>
              <TableCell>Đội {item.teamName}</TableCell>
              <TableCell className="text-right font-medium">
                {item.share.amount.toLocaleString()} VNĐ
              </TableCell>
              <TableCell>
                <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                  Đã trả
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

// Main Members Component
const defaultAdminTabs = ["dashboard", "scoring", "live"];

const Members = () => {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberNickname, setNewMemberNickname] = useState("");
  const [newMemberIsExempt, setNewMemberIsExempt] = useState(false);
  const [newMemberAutoAttendance, setNewMemberAutoAttendance] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [memberStats, setMemberStats] = useState<Map<string, MemberStats>>(
    new Map()
  );
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoadingUserRole, setIsLoadingUserRole] = useState(false);
  // Multi-select state for bulk actions.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const availableAdminTabs = useMemo(
    () => [
      { key: "dashboard", label: "Dashboard" },
      { key: "matches", label: "Quản lý Trận đấu", superOnly: true },
      { key: "members", label: "Thành viên", superOnly: true },
      { key: "scoring", label: "Chấm điểm" },
      { key: "live", label: "Ghi chú live" },
      { key: "public", label: "Trang Public" },
    ],
    []
  );

  useEffect(() => {
    const fetchUserRoles = async () => {
      if (!editingMember?.authUid) return;
      setIsLoadingUserRole(true);
      try {
        const snap = await getDoc(doc(db, "userRoles", editingMember.authUid));
        if (snap.exists()) {
          const data = snap.data() as any;
          const tabsFromRole = Array.isArray(data.tabs)
            ? (data.tabs as string[])
            : defaultAdminTabs;
          const roleFromRole = Array.isArray(data.roles)
            ? (data.roles as string[])[0]
            : editingMember.loginRole || "admin";
          setEditingMember((prev) =>
            prev && prev.id === editingMember.id
              ? {
                  ...prev,
                  adminTabs: prev.adminTabs || tabsFromRole,
                  loginRole: prev.loginRole || roleFromRole,
                }
              : prev
          );
        } else if (!editingMember.adminTabs) {
          setEditingMember((prev) =>
            prev && prev.id === editingMember.id
              ? { ...prev, adminTabs: defaultAdminTabs }
              : prev
          );
        }
      } catch (err) {
        console.error("Failed to fetch userRoles for member", err);
      } finally {
        setIsLoadingUserRole(false);
      }
    };
    fetchUserRoles();
  }, [editingMember?.authUid]);
  const { toast } = useToast();

  const fetchMembersAndStats = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch members
      const membersCollectionRef = collection(db, "members");
      const membersSnapshot = await getDocs(membersCollectionRef);
      const membersList = membersSnapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Member)
      );
      setMembers(membersList);

      // Fetch all paid shares to calculate stats
      const paidSharesQuery = query(
        collectionGroup(db, "shares"),
        where("status", "==", "PAID")
      );
      const paidSharesSnapshot = await getDocs(paidSharesQuery);
      const stats = new Map<string, MemberStats>();

      paidSharesSnapshot.forEach((doc) => {
        const share = doc.data();
        const currentStats = stats.get(share.memberId) || { totalPaid: 0 };
        currentStats.totalPaid += share.amount;
        stats.set(share.memberId, currentStats);
      });
      setMemberStats(stats);
    } catch (error) {
      console.error("Error fetching members and stats: ", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not fetch data from the database.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchMembersAndStats();
  }, [fetchMembersAndStats]);

  const removeDiacritics = (str: string) => {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  };

  const generateLoginEmail = (name: string, memberId: string) => {
    const slug =
      removeDiacritics(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 12) || "user";
    const suffix = memberId.slice(0, 4);
    return `${slug}.${suffix}@member.local`;
  };

  const filteredMembers = useMemo(
    () =>
      members
        .filter((m) => {
          if (!showInactive && m.inactive) return false;
          const lowerCaseSearch = removeDiacritics(search.toLowerCase());
          return (
            removeDiacritics(m.name.toLowerCase()).includes(lowerCaseSearch) ||
            (m.nickname &&
              removeDiacritics(m.nickname.toLowerCase()).includes(
                lowerCaseSearch
              ))
          );
        })
        .sort((a, b) => {
          // Priority first, then normal, then inactive
          const rankOf = (m: Member) =>
            m.inactive ? 2 : m.isPriority ? 0 : 1;
          return rankOf(a) - rankOf(b);
        }),
    [members, search, showInactive]
  );

  const handleAddMember = async () => {
    if (!newMemberName.trim()) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Member name cannot be empty.",
      });
      return;
    }
    setIsAdding(true);
    try {
      await addDoc(collection(db, "members"), {
        name: newMemberName,
        nickname: newMemberNickname || "",
        isExemptFromPayment: newMemberIsExempt,
        autoAttendance: newMemberAutoAttendance,
        createdAt: serverTimestamp(),
      });
      toast({
        title: "Success",
        description: `Member "${newMemberName}" has been added.`,
      });
      setNewMemberName("");
      setNewMemberNickname("");
      setNewMemberIsExempt(false);
      setNewMemberAutoAttendance(false);
      fetchMembersAndStats(); // Refresh the list
    } catch (error) {
      console.error("Error adding member: ", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not add the new member.",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteMember = async (id: string, name: string) => {
    const originalMembers = [...members];
    setMembers(members.filter((m) => m.id !== id));

    try {
      await deleteDoc(doc(db, "members", id));
      toast({
        title: "Success",
        description: `Member "${name}" has been deleted.`,
      });
      // No need to refetch, stats for deleted member will just be ignored
    } catch (error) {
      console.error("Error deleting member: ", error);
      setMembers(originalMembers); // Revert on error
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not delete the member. Please try again.",
      });
    }
  };

  const handleToggleExemption = async (
    memberId: string,
    currentStatus: boolean
  ) => {
    const memberRef = doc(db, "members", memberId);
    try {
      await updateDoc(memberRef, { isExemptFromPayment: !currentStatus });
      toast({
        title: "Thành công",
        description: "Đã cập nhật trạng thái miễn trừ thanh toán.",
      });
      fetchMembersAndStats(); // Refresh list
    } catch (error) {
      console.error("Error toggling payment exemption:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái. Vui lòng thử lại.",
      });
    }
  };

  const handleUpdateMember = async (
    id: string,
    updatedData: Partial<Member>
  ) => {
    const stripUndefined = (data: Partial<Member>) =>
      Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined)
      );

    if (!updatedData.name?.trim()) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Tên thành viên không được để trống.",
      });
      return;
    }
    setIsUpdating(true);
    try {
      const memberRef = doc(db, "members", id);

      let authUid = updatedData.authUid;
      let loginEmail = updatedData.loginEmail;
      const loginRole = updatedData.loginRole;
      let existingRoles: string[] = [];
      if (updatedData.loginEnabled) {
        if (!authUid && !loginPassword) {
          toast({
            variant: "destructive",
            title: "Thiếu mật khẩu",
            description: "Nhập mật khẩu để tạo tài khoản đăng nhập.",
          });
          setIsUpdating(false);
          return;
        }

        // Nếu chưa có UID/email -> tự tạo tài khoản với email auto
        if (!authUid) {
          const generatedEmail = generateLoginEmail(
            updatedData.name || "user",
            id
          );
          const secondaryApp = initializeApp(
            (await import("@/lib/firebase")).app.options,
            `secondary-${Date.now()}`
          );
          try {
            const secondaryAuth = getAuth(secondaryApp);
            const cred = await createUserWithEmailAndPassword(
              secondaryAuth,
              generatedEmail,
              loginPassword
            );
            authUid = cred.user.uid;
            loginEmail = generatedEmail;
          } catch (err) {
            console.error("Error creating auth user:", err);
            toast({
              variant: "destructive",
              title: "Không tạo được tài khoản",
              description:
                "Kiểm tra lại mật khẩu hoặc thử lại. Có thể email bị trùng.",
            });
            throw err;
          } finally {
            await deleteApp(secondaryApp);
          }
        }

        // Nếu chưa chọn role, dùng role hiện có (nếu có) hoặc mặc định admin
        if (!loginRole && authUid) {
          const roleSnap = await getDoc(doc(db, "userRoles", authUid));
          const data = roleSnap.data();
          if (Array.isArray(data?.roles)) {
            existingRoles = data.roles;
          }
        }
        const finalRole = loginRole || existingRoles[0] || "admin";

        // Lưu role vào userRoles
        await setDoc(
          doc(db, "userRoles", authUid),
          {
            roles: [finalRole],
            tabs:
              updatedData.adminTabs && updatedData.adminTabs.length > 0
                ? updatedData.adminTabs
                : defaultAdminTabs,
          },
          { merge: true }
        );

        updatedData.authUid = authUid;
        updatedData.loginEmail = loginEmail;
        updatedData.loginRole = finalRole;
        updatedData.adminTabs =
          updatedData.adminTabs && updatedData.adminTabs.length > 0
            ? updatedData.adminTabs
            : defaultAdminTabs;
      }

      await updateDoc(memberRef, stripUndefined(updatedData));

      setLoginPassword("");
      toast({
        title: "Thành công",
        description: "Đã cập nhật thông tin thành viên.",
      });
      fetchMembersAndStats(); // Refresh the list
      setIsEditModalOpen(false); // Close the modal
      setEditingMember(null);
    } catch (error) {
      console.error("Error updating member:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật thông tin thành viên.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  // ===== Bulk actions =====
  type BulkField =
    | "isExemptFromPayment"
    | "autoAttendance"
    | "inactive"
    | "isPriority";

  const bulkLabels: Record<BulkField, string> = {
    isExemptFromPayment: "Miễn chia tiền",
    autoAttendance: "Auto Điểm danh",
    inactive: "Inactive",
    isPriority: "Ưu tiên",
  };

  const selectedCount = selectedIds.size;

  const visibleSelectedIds = useMemo(
    () => filteredMembers.filter((m) => selectedIds.has(m.id)).map((m) => m.id),
    [filteredMembers, selectedIds]
  );

  const allVisibleSelected =
    filteredMembers.length > 0 &&
    visibleSelectedIds.length === filteredMembers.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredMembers.forEach((m) => next.delete(m.id));
      } else {
        filteredMembers.forEach((m) => next.add(m.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkUpdate = async (field: BulkField, value: boolean) => {
    if (selectedCount === 0) return;
    setIsBulkProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.update(doc(db, "members", id), { [field]: value });
      });
      await batch.commit();

      // Optimistic local update so UI reflects change without a re-fetch.
      setMembers((prev) =>
        prev.map((m) =>
          selectedIds.has(m.id) ? { ...m, [field]: value } : m
        )
      );

      toast({
        title: "Đã cập nhật",
        description: `${value ? "Bật" : "Tắt"} "${bulkLabels[field]}" cho ${selectedCount} thành viên.`,
      });
      clearSelection();
    } catch (error) {
      console.error("Bulk update failed:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật hàng loạt. Vui lòng thử lại.",
      });
      fetchMembersAndStats();
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    setIsBulkProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.delete(doc(db, "members", id));
      });
      await batch.commit();

      const idsToRemove = new Set(selectedIds);
      setMembers((prev) => prev.filter((m) => !idsToRemove.has(m.id)));

      toast({
        title: "Đã xoá",
        description: `Đã xoá ${selectedCount} thành viên.`,
      });
      clearSelection();
      setIsBulkDeleteOpen(false);
    } catch (error) {
      console.error("Bulk delete failed:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xoá hàng loạt. Vui lòng thử lại.",
      });
      fetchMembersAndStats();
    } finally {
      setIsBulkProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-primary rounded-xl shadow-card">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Quản lý thành viên
              </h1>
              <p className="text-muted-foreground">
                Danh sách người chơi đá bóng
              </p>
            </div>
          </div>
        </div>

        {/* Add Member Card */}
        <Card className="mb-6 shadow-card hover:shadow-card-hover transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Thêm thành viên mới
            </CardTitle>
            <CardDescription>Nhập tên và biệt danh (tùy chọn)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Tên đầy đủ *"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
                  className="flex-1"
                  disabled={isAdding}
                />
                <Input
                  placeholder="Biệt danh"
                  value={newMemberNickname}
                  onChange={(e) => setNewMemberNickname(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
                  className="sm:w-48"
                  disabled={isAdding}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="exempt-payment-new"
                      checked={newMemberIsExempt}
                      onCheckedChange={setNewMemberIsExempt}
                    />
                    <Label
                      htmlFor="exempt-payment-new"
                      className="whitespace-nowrap"
                    >
                      Miễn chia tiền
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-attendance-new"
                      checked={newMemberAutoAttendance}
                      onCheckedChange={setNewMemberAutoAttendance}
                    />
                    <Label
                      htmlFor="auto-attendance-new"
                      className="whitespace-nowrap"
                    >
                      Auto Điểm danh
                    </Label>
                  </div>
                </div>
                <Button
                  onClick={handleAddMember}
                  className="w-full sm:w-auto"
                  disabled={isAdding}
                >
                  {isAdding ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  {isAdding ? "Đang thêm..." : "Thêm"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search */}
        <Card className="mb-6 shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm kiếm theo tên hoặc biệt danh..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <Switch
                  id="show-inactive"
                  checked={showInactive}
                  onCheckedChange={setShowInactive}
                />
                <Label htmlFor="show-inactive" className="whitespace-nowrap text-sm">
                  Hiện inactive
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Members List */}
        <Card className="shadow-card">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>
                Danh sách thành viên ({filteredMembers.length})
              </CardTitle>
              {filteredMembers.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={toggleSelectAllVisible}
                    aria-label="Chọn tất cả"
                  />
                  Chọn tất cả
                </label>
              )}
            </div>

            {/* Bulk action bar — visible only when there is a selection */}
            {selectedCount > 0 && (
              <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border bg-primary/5 px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="default" className="px-2 py-0.5">
                    Đã chọn {selectedCount}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    className="h-7 px-2 text-xs"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Bỏ chọn
                  </Button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(
                    [
                      {
                        field: "isExemptFromPayment" as const,
                        label: "Miễn chia",
                        icon: BadgePercent,
                      },
                      {
                        field: "autoAttendance" as const,
                        label: "Auto",
                        icon: Repeat,
                      },
                      {
                        field: "isPriority" as const,
                        label: "Ưu tiên",
                        icon: ArrowUp,
                      },
                      {
                        field: "inactive" as const,
                        label: "Inactive",
                        icon: UserX,
                      },
                    ]
                  ).map(({ field, label, icon: Icon }) => (
                    <DropdownMenu key={field}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBulkProcessing}
                          className="h-8 gap-1.5"
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>
                          {bulkLabels[field]}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleBulkUpdate(field, true)}
                        >
                          <CheckSquare className="h-4 w-4 mr-2 text-emerald-600" />
                          Bật cho {selectedCount} người
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleBulkUpdate(field, false)}
                        >
                          <Square className="h-4 w-4 mr-2 text-muted-foreground" />
                          Tắt cho {selectedCount} người
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsBulkDeleteOpen(true)}
                    disabled={isBulkProcessing}
                    className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {isBulkProcessing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Xoá
                  </Button>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin opacity-50" />
                  <p>Đang tải danh sách...</p>
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Chưa có thành viên nào</p>
                </div>
              ) : (
                filteredMembers.map((member) => (
                  <div
                    key={member.id}
                    className={`flex items-center justify-between p-4 rounded-lg border hover:shadow-md transition-all ${
                      selectedIds.has(member.id)
                        ? "bg-primary/5 border-primary/40"
                        : member.inactive
                        ? "opacity-50 bg-muted/30"
                        : "bg-gradient-card"
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-grow min-w-0">
                      <Checkbox
                        checked={selectedIds.has(member.id)}
                        onCheckedChange={() => toggleSelect(member.id)}
                        aria-label={`Chọn ${member.name}`}
                        className="shrink-0"
                      />
                      <Dialog>
                        <DialogTrigger asChild>
                          <div className="flex items-center gap-4 cursor-pointer flex-grow min-w-0">
                            <div className="h-12 w-12 shrink-0 rounded-full bg-primary flex items-center justify-center text-white font-semibold shadow-card">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="space-y-1 min-w-0">
                              <p className="font-semibold text-foreground truncate">
                                {member.name}
                              </p>
                              {member.nickname && (
                                <Badge variant="secondary" className="mt-1">
                                  {member.nickname}
                                </Badge>
                              )}
                              <div className="flex flex-wrap gap-1 mt-1">
                                {member.isPriority && (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500 text-amber-600"
                                  >
                                    <ArrowUp className="h-3 w-3 mr-0.5" />
                                    Ưu tiên
                                  </Badge>
                                )}
                                {member.inactive && (
                                  <Badge
                                    variant="outline"
                                    className="border-slate-400 text-slate-500"
                                  >
                                    <UserX className="h-3 w-3 mr-0.5" />
                                    Inactive
                                  </Badge>
                                )}
                                {member.autoAttendance && (
                                  <Badge
                                    variant="outline"
                                    className="border-blue-500 text-blue-500"
                                  >
                                    Auto
                                  </Badge>
                                )}
                              </div>
                              {member.loginEnabled && (
                                <div className="flex flex-wrap gap-2">
                                  <Badge variant="outline">Login bật</Badge>
                                  {member.loginEmail && (
                                    <Badge variant="secondary">
                                      {member.loginEmail}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader>
                            <DialogTitle>
                              Lịch sử tham gia của {member.name}
                            </DialogTitle>
                            <DialogDescription>
                              Tất cả các trận đấu đã thanh toán của thành viên.
                            </DialogDescription>
                          </DialogHeader>
                          <MemberDetails memberId={member.id} />
                        </DialogContent>
                      </Dialog>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">
                          Tổng đã trả
                        </p>
                        <p className="font-semibold text-green-500 flex items-center justify-end gap-1">
                          <DollarSign className="h-4 w-4" />
                          {(
                            memberStats.get(member.id)?.totalPaid || 0
                          ).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingMember(member);
                                setIsEditModalOpen(true);
                              }}
                              className="h-8 w-8"
                            >
                              <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Chỉnh sửa thành viên</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleExemption(
                                  member.id,
                                  !!member.isExemptFromPayment
                                );
                              }}
                              className="h-8 w-8"
                            >
                              <BadgePercent
                                className={`h-5 w-5 transition-colors ${
                                  member.isExemptFromPayment
                                    ? "text-green-500 fill-green-500/20"
                                    : "text-muted-foreground hover:text-green-500"
                                }`}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {member.isExemptFromPayment
                              ? "Tắt miễn chia tiền"
                              : "Bật miễn chia tiền"}
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteMember(member.id, member.name);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Xoá thành viên</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        {editingMember && (
          <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Chỉnh sửa thành viên</DialogTitle>
                <DialogDescription>
                  Cập nhật thông tin cho {editingMember.name}.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Tên đầy đủ</Label>
                  <Input
                    id="edit-name"
                    defaultValue={editingMember.name}
                    onChange={(e) =>
                      setEditingMember({
                        ...editingMember,
                        name: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-nickname">Biệt danh</Label>
                  <Input
                    id="edit-nickname"
                    defaultValue={editingMember.nickname}
                    onChange={(e) =>
                      setEditingMember({
                        ...editingMember,
                        nickname: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-exempt"
                    checked={!!editingMember.isExemptFromPayment}
                    onCheckedChange={(checked) =>
                      setEditingMember({
                        ...editingMember,
                        isExemptFromPayment: checked,
                      })
                    }
                  />
                  <Label htmlFor="edit-exempt">Miễn chia tiền</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-auto-attendance"
                    checked={!!editingMember.autoAttendance}
                    onCheckedChange={(checked) =>
                      setEditingMember({
                        ...editingMember,
                        autoAttendance: checked,
                      })
                    }
                  />
                  <Label htmlFor="edit-auto-attendance">Auto Điểm danh</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-priority"
                    checked={!!editingMember.isPriority}
                    onCheckedChange={(checked) =>
                      setEditingMember({
                        ...editingMember,
                        isPriority: checked,
                      })
                    }
                  />
                  <Label htmlFor="edit-priority">Ưu tiên (hiện đầu danh sách)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-inactive"
                    checked={!!editingMember.inactive}
                    onCheckedChange={(checked) =>
                      setEditingMember({
                        ...editingMember,
                        inactive: checked,
                      })
                    }
                  />
                  <Label htmlFor="edit-inactive">Inactive (ẩn khỏi điểm danh & setup)</Label>
                </div>
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="edit-login-enabled"
                      checked={!!editingMember.loginEnabled}
                      onCheckedChange={(checked) =>
                        setEditingMember({
                          ...editingMember,
                          loginEnabled: checked,
                        })
                      }
                    />
                    <Label htmlFor="edit-login-enabled">
                      Bật đăng nhập cho member này
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label>Role đăng nhập</Label>
                    <Select
                      value={editingMember.loginRole || "admin"}
                      onValueChange={(val) =>
                        setEditingMember({ ...editingMember, loginRole: val })
                      }
                      disabled={!editingMember.loginEnabled}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="superadmin">Superadmin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {editingMember.loginRole === "admin" && (
                    <div className="space-y-2">
                      <Label>
                        Tab được phép hiển thị cho admin này{" "}
                        {isLoadingUserRole && (
                          <span className="text-xs text-muted-foreground">
                            (Đang tải...)
                          </span>
                        )}
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        {availableAdminTabs.map((tab) => {
                          const currentTabs = editingMember.adminTabs || [];
                          const checked =
                            currentTabs.length === 0 ||
                            currentTabs.includes(tab.key);
                          return (
                            <label
                              key={tab.key}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={checked}
                                onChange={(e) => {
                                  const newTabs = new Set(
                                    currentTabs.length === 0
                                      ? availableAdminTabs.map((t) => t.key)
                                      : currentTabs
                                  );
                                  if (e.target.checked) {
                                    newTabs.add(tab.key);
                                  } else {
                                    newTabs.delete(tab.key);
                                  }
                                  setEditingMember({
                                    ...editingMember,
                                    adminTabs: Array.from(newTabs),
                                  });
                                }}
                              />
                              {tab.label}
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Nếu bỏ chọn hết, hệ thống mặc định: Dashboard, Chấm
                        điểm, Ghi chú live.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Email đăng nhập (tự tạo)</Label>
                    <Input
                      value={editingMember.loginEmail || "Sẽ tạo tự động"}
                      readOnly
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      Hệ thống sẽ sinh email từ tên + id. Bạn không cần nhập.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Auth UID</Label>
                    <Input
                      value={
                        editingMember.authUid || "Sẽ tạo tự động sau khi lưu"
                      }
                      readOnly
                      disabled
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-login-password">
                      Mật khẩu (tạo tài khoản mới)
                    </Label>
                    <Input
                      id="edit-login-password"
                      type="password"
                      placeholder="Nhập mật khẩu để tạo tài khoản mới"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      disabled={!editingMember.loginEnabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      Nếu đã có Auth UID/Email sẵn, có thể bỏ trống mật khẩu và
                      chỉ dán UID + Email.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Hủy
                </Button>
                <Button
                  onClick={() =>
                    handleUpdateMember(editingMember.id, {
                      name: editingMember.name,
                      nickname: editingMember.nickname,
                      isExemptFromPayment: editingMember.isExemptFromPayment,
                      autoAttendance: editingMember.autoAttendance,
                      loginEnabled: editingMember.loginEnabled,
                      authUid: editingMember.authUid,
                      loginEmail: editingMember.loginEmail,
                      adminTabs: editingMember.adminTabs,
                      loginRole: editingMember.loginRole,
                      inactive: editingMember.inactive,
                      isPriority: editingMember.isPriority,
                    })
                  }
                  disabled={isUpdating}
                >
                  {isUpdating && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Lưu thay đổi
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        <AlertDialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Xoá {selectedCount} thành viên?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Hành động này không thể hoàn tác. Các thành viên sau sẽ bị xoá
                khỏi danh sách:
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
              <ul className="space-y-1">
                {members
                  .filter((m) => selectedIds.has(m.id))
                  .map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                      {m.name}
                      {m.nickname && (
                        <span className="text-muted-foreground text-xs">
                          ({m.nickname})
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBulkProcessing}>
                Hủy
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleBulkDelete();
                }}
                disabled={isBulkProcessing}
                className="bg-destructive hover:bg-destructive/90"
              >
                {isBulkProcessing && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Xác nhận xoá
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default Members;
