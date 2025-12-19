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
  Star,
  BadgePercent,
  Pencil,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  isCreditor?: boolean;
  isExemptFromPayment?: boolean;
  loginEnabled?: boolean;
  authUid?: string;
  loginEmail?: string;
  loginRole?: string;
  adminTabs?: string[];
  autoAttendance?: boolean;
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

  const handleSetCreditor = async (newCreditorId: string) => {
    const currentCreditor = members.find((m) => m.isCreditor);

    if (currentCreditor?.id === newCreditorId) {
      // If clicking the same creditor, do nothing or maybe deselect?
      // For now, let's just do nothing to enforce one creditor.
      return;
    }

    const batch = writeBatch(db);

    // 1. Unset the old creditor
    if (currentCreditor) {
      const oldCreditorRef = doc(db, "members", currentCreditor.id);
      batch.update(oldCreditorRef, { isCreditor: false });
    }

    // 2. Set the new creditor
    const newCreditorRef = doc(db, "members", newCreditorId);
    batch.update(newCreditorRef, { isCreditor: true });

    try {
      await batch.commit();
      toast({
        title: "Thành công",
        description: "Đã cập nhật chủ nợ mới.",
      });
      fetchMembersAndStats(); // Refresh the list with new data
    } catch (error) {
      console.error("Error setting creditor:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật chủ nợ. Vui lòng thử lại.",
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
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm theo tên hoặc biệt danh..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Members List */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>
              Danh sách thành viên ({filteredMembers.length})
            </CardTitle>
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
                    className="flex items-center justify-between p-4 rounded-lg border bg-gradient-card hover:shadow-md transition-all"
                  >
                    <Dialog>
                      <DialogTrigger asChild>
                        <div className="flex items-center gap-4 cursor-pointer flex-grow">
                          <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center text-white font-semibold shadow-card">
                            {member.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="space-y-1">
                            <p className="font-semibold text-foreground">
                              {member.name}
                            </p>
                            {member.nickname && (
                              <Badge variant="secondary" className="mt-1">
                                {member.nickname}
                              </Badge>
                            )}
                            {member.autoAttendance && (
                              <Badge
                                variant="outline"
                                className="mt-1 ml-2 border-blue-500 text-blue-500"
                              >
                                Auto
                              </Badge>
                            )}
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
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetCreditor(member.id);
                          }}
                          className="h-8 w-8"
                        >
                          <Star
                            className={`h-5 w-5 transition-colors ${
                              member.isCreditor
                                ? "text-yellow-400 fill-yellow-400"
                                : "text-muted-foreground hover:text-yellow-400"
                            }`}
                          />
                        </Button>
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
      </div>
    </div>
  );
};

export default Members;
