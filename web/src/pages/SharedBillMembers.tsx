import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";
import { BillMember, billError } from "@/lib/bills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import {
  Search,
  Users,
  Loader2,
  Plus,
  Pencil,
  X,
  UserX,
  UserCheck,
  History,
} from "lucide-react";

const SharedBillMembers = () => {
  const { groupId } = useGroup();
  const groupPath = useGroupPath();
  const { user } = useAuth();
  const [members, setMembers] = useState<BillMember[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [editing, setEditing] = useState<BillMember | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const data = (await apiRequest("GET", `/groups/${groupId}/bills/members`)) as BillMember[];
      setMembers(data);
    } catch (cause: unknown) {
      setError(billError(cause));
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest("GET", `/groups/${groupId}/bills/members`)
      .then((data) => {
        if (!cancelled) setMembers(data as BillMember[]);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(billError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const newId = crypto.randomUUID();
      await apiRequest("PUT", `/groups/${groupId}/bills/members/${newId}`, {
        id: newId,
        name: newMemberName.trim(),
        inactive: false,
      });
      setNewMemberName("");
      toast({ title: "Đã thêm thành viên mới thành công" });
      await reload();
    } catch (cause: unknown) {
      setError(billError(cause));
      toast({ variant: "destructive", title: "Lỗi thêm thành viên", description: billError(cause) });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest("PUT", `/groups/${groupId}/bills/members/${editing.id}`, {
        ...editing,
        name: editName.trim(),
      });
      setEditing(null);
      setEditName("");
      toast({ title: "Đã cập nhật thông tin thành viên" });
      await reload();
    } catch (cause: unknown) {
      setError(billError(cause));
      toast({ variant: "destructive", title: "Lỗi cập nhật", description: billError(cause) });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleInactive = async (member: BillMember) => {
    setBusy(true);
    setError("");
    try {
      await apiRequest("PUT", `/groups/${groupId}/bills/members/${member.id}`, {
        ...member,
        inactive: !member.inactive,
      });
      toast({
        title: member.inactive ? "Đã cho thành viên tham gia lại" : "Đã chuyển thành viên sang ngừng tham gia",
      });
      await reload();
    } catch (cause: unknown) {
      setError(billError(cause));
      toast({ variant: "destructive", title: "Lỗi cập nhật trạng thái", description: billError(cause) });
    } finally {
      setBusy(false);
    }
  };

  const handleClaimSelf = async (member: BillMember) => {
    if (!user) {
      toast({ variant: "destructive", title: "Vui lòng đăng nhập" });
      return;
    }
    setClaimingId(member.id);
    try {
      await apiRequest("PUT", `/groups/${groupId}/bills/members/${member.id}`, {
        ...member,
        accountUid: user.uid,
      });
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, accountUid: user.uid } : m))
      );
      toast({
        title: "Đã liên kết hồ sơ của bạn thành công",
        description: "Hệ thống đã nhận diện đây là hồ sơ của bạn trong nhóm chia tiền này.",
      });
    } catch (cause: unknown) {
      toast({ variant: "destructive", title: "Lỗi liên kết", description: billError(cause) });
    } finally {
      setClaimingId(null);
    }
  };

  const handleUnclaimSelf = async (member: BillMember) => {
    if (!user) return;
    setClaimingId(member.id);
    try {
      await apiRequest("PUT", `/groups/${groupId}/bills/members/${member.id}`, {
        ...member,
        accountUid: null,
      });
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, accountUid: null } : m))
      );
      toast({
        title: "Đã hủy liên kết tài khoản với hồ sơ này",
      });
    } catch (cause: unknown) {
      toast({ variant: "destructive", title: "Lỗi hủy liên kết", description: billError(cause) });
    } finally {
      setClaimingId(null);
    }
  };

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, searchQuery]);

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-indigo-600" />
              Thành viên chia tiền
            </h1>
            <p className="text-sm text-muted-foreground">
              Thêm tất cả người chia tiền định kỳ, bao gồm cả bạn. Thành viên không bắt buộc phải có tài khoản.
            </p>
          </div>
        </header>

        {error && (
          <p role="alert" className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20">
            {error}
          </p>
        )}

        {/* Add Member Card */}
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleAddMember} className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="new-member-name">Thêm thành viên mới</Label>
                <Input
                  id="new-member-name"
                  value={newMemberName}
                  maxLength={60}
                  placeholder="Nhập tên người tham gia (VD: Thiên Nhỏ, Huy...)"
                  required
                  onChange={(e) => setNewMemberName(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy || !newMemberName.trim()} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Thêm thành viên
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Search & List */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Tìm kiếm thành viên theo tên..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center space-y-2">
              <Users className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="font-medium text-foreground">Chưa có thành viên nào</p>
              <p className="text-xs text-muted-foreground">Nhập tên vào ô phía trên để bắt đầu thêm người tham gia chia tiền.</p>
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Không tìm thấy thành viên nào khớp với &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredMembers.map((member) => (
                <div
                  key={member.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5 bg-card transition-all ${
                    member.inactive ? "opacity-60 bg-muted/20" : "hover:border-primary/40 shadow-xs"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground truncate">{member.name}</span>

                        {member.accountUid === user?.uid && (
                          <div className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-[11px] font-medium cursor-default">
                                  ⭐ Bạn (Tài khoản của bạn)
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Hồ sơ này đã liên kết với tài khoản đăng nhập của bạn.
                              </TooltipContent>
                            </Tooltip>
                            <button
                              type="button"
                              onClick={() => handleUnclaimSelf(member)}
                              disabled={claimingId === member.id}
                              className="text-[10px] text-muted-foreground hover:text-destructive underline"
                              title="Hủy liên kết tài khoản"
                            >
                              Hủy
                            </button>
                          </div>
                        )}

                        {!member.accountUid && user && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => handleClaimSelf(member)}
                                disabled={claimingId === member.id}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition-colors font-medium"
                              >
                                {claimingId === member.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <span>⭐ Tôi là thành viên này</span>
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              Bấm để nhận diện đây là hồ sơ của bạn trong nhóm chia tiền này.
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {member.inactive && (
                          <Badge variant="outline" className="border-slate-400 text-slate-500 text-[11px]">
                            <UserX className="h-3 w-3 mr-0.5" />
                            Đã ngừng tham gia
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          className="text-xs text-muted-foreground hover:text-primary hover:underline inline-flex items-center gap-1"
                          to={groupPath(`admin/bill-history?memberId=${encodeURIComponent(member.id)}`)}
                        >
                          <History className="h-3 w-3" />
                          Xem lịch sử chia tiền
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="text-xs h-8 gap-1"
                      onClick={() => {
                        setEditing(member);
                        setEditName(member.name);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Sửa
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className={`text-xs h-8 gap-1 ${member.inactive ? "text-emerald-600 hover:bg-emerald-50" : "text-muted-foreground"}`}
                      onClick={() => void handleToggleInactive(member)}
                    >
                      {member.inactive ? (
                        <>
                          <UserCheck className="h-3.5 w-3.5" />
                          Cho tham gia lại
                        </>
                      ) : (
                        <>
                          <UserX className="h-3.5 w-3.5" />
                          Ngừng tham gia
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Ngừng tham gia vẫn bảo lưu toàn bộ lịch sử thanh toán cũ. Hãy cập nhật các khoản thu định kỳ để điều chỉnh danh sách chia từ kỳ tới.
        </p>

        {/* Edit Member Dialog */}
        <Dialog open={editing !== null} onOpenChange={(val) => { if (!val) setEditing(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-4 w-4" />
                Chỉnh sửa thành viên
              </DialogTitle>
              <DialogDescription>
                Cập nhật thông tin cho thành viên: {editing?.name}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-member-name">Tên thành viên</Label>
                <Input
                  id="edit-member-name"
                  value={editName}
                  maxLength={60}
                  required
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nhập tên..."
                />
              </div>

              {editing && (
                <div className="border-t pt-3 space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">Liên kết tài khoản hệ thống</Label>
                  {editing.accountUid === user?.uid ? (
                    <div className="flex items-center justify-between p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs">
                      <span className="text-amber-700 dark:text-amber-300 font-medium">⭐ Đang liên kết với tài khoản của bạn</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          handleUnclaimSelf(editing);
                          setEditing({ ...editing, accountUid: null });
                        }}
                      >
                        Hủy liên kết
                      </Button>
                    </div>
                  ) : editing.accountUid ? (
                    <div className="p-2 rounded bg-muted text-xs text-muted-foreground">
                      Đã liên kết với tài khoản UID: <span className="font-mono">{editing.accountUid}</span>
                    </div>
                  ) : user ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full text-xs gap-1.5"
                      onClick={() => {
                        handleClaimSelf(editing);
                        setEditing({ ...editing, accountUid: user.uid });
                      }}
                    >
                      ⭐ Liên kết hồ sơ này với tài khoản của tôi
                    </Button>
                  ) : null}
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                  Hủy
                </Button>
                <Button type="submit" disabled={busy || !editName.trim()} className="gap-1.5">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Lưu thay đổi
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default SharedBillMembers;
