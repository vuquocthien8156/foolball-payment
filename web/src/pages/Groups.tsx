import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { apiRequest } from "@/lib/api";
import { GROUP_SPORTS, SPORT_LABELS, GroupSport, groupPath } from "@/lib/groups";
import { usePlatformAccount } from "@/hooks/usePlatformAccount";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Users, Trash2, Shield, Loader2, UserPlus, X } from "lucide-react";

type Group = {
  id: string;
  name: string;
  sport: GroupSport;
  status: string;
  role: string;
  ownerUid?: string | null;
  ownerDisplayName?: string | null;
  ownerEmail?: string | null;
};

type CoManager = {
  uid: string;
  email: string;
  displayName?: string;
  role: string;
};

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
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Create Group State
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [sport, setSport] = useState<GroupSport | "">("");
  const [busy, setBusy] = useState(false);

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
    if (!sport || name.trim().length < 2) {
      toast({ variant: "destructive", title: "Nhập tên nhóm và chọn môn thể thao" });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, any> = { name: name.trim(), sport };
      if (slug.trim()) {
        payload.id = slug.trim().toLowerCase();
      }
      const created = await apiRequest("POST", "/platform/groups", payload);
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

  return (
    <main className="container max-w-5xl py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Quản lý Nhóm</h1>
          <p className="text-muted-foreground">{account?.displayName || account?.email}</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Nền tảng">
          {account?.role === "owner" && (
            <Button asChild variant="outline">
              <Link to="/platform/accounts">Tài khoản</Link>
            </Button>
          )}
          <Button onClick={() => {
            setName("");
            setSlug("");
            setSlugManuallyEdited(false);
            setSport("");
            setOpen(true);
          }}>
            Tạo nhóm mới
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await signOut(auth);
              navigate("/platform/login");
            }}
          >
            Đăng xuất
          </Button>
        </nav>
      </header>

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const isOwnerOrSuper = account?.role === "owner" || group.role === "owner";
            return (
              <Card key={group.id} className="flex flex-col justify-between shadow-xs">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="break-words text-lg font-bold">{group.name}</CardTitle>
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                      {SPORT_LABELS[group.sport] || SPORT_LABELS.other}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">/g/{group.id}</p>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <div className="space-y-1 text-sm border-t pt-3">
                    <div className="flex items-center justify-between text-muted-foreground text-xs">
                      <span>Vai trò của bạn:</span>
                      <span className="font-semibold text-foreground">
                        {group.role === "owner" ? "Chủ nhóm (Owner)" : group.role === "manager" ? "Quản lý" : "Quản trị viên"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground text-xs">
                      <span>Chủ nhóm:</span>
                      <span className="font-medium text-foreground truncate max-w-[150px]">
                        {group.ownerDisplayName || group.ownerEmail || (group.ownerUid ? "Owner" : "Hệ thống")}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button asChild variant="default" size="sm" className="flex-1">
                      <Link to={groupPath(group.id, "admin")}>Mở nhóm</Link>
                    </Button>

                    {isOwnerOrSuper && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openCoManagers(group)}
                          title="Phân quyền đồng quản lý"
                        >
                          <Users className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => setGroupToDelete(group)}
                          title="Xóa nhóm"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
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

            <div>
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
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                Hủy
              </Button>
              <Button disabled={busy || !sport || name.trim().length < 2} type="submit">
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

          <form onSubmit={handleAddCoManager} className="space-y-3 pt-2">
            <Label htmlFor="manager-email">Thêm đồng quản lý (Email tài khoản)</Label>
            <div className="flex gap-2">
              <Input
                id="manager-email"
                type="email"
                placeholder="user@example.com"
                value={newManagerEmail}
                onChange={(e) => setNewManagerEmail(e.target.value)}
                required
              />
              <Select value={newManagerRole} onValueChange={(val: "manager" | "admin") => setNewManagerRole(val)}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Quản lý</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={addingManager || !newManagerEmail.trim()}>
                {addingManager ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              </Button>
            </div>
          </form>

          <div className="border-t pt-3 mt-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Danh sách quản lý hiện tại
            </h4>
            {loadingManagers ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : coManagers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">Chưa có đồng quản lý nào.</p>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {coManagers.map((m) => (
                  <div key={m.uid} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm">
                    <div>
                      <p className="font-medium">{m.displayName || m.email}</p>
                      <p className="text-xs text-muted-foreground">{m.email} · {m.role === "manager" ? "Quản lý" : "Admin"}</p>
                    </div>
                    {m.uid !== selectedGroupForManagers?.ownerUid && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveCoManager(m.uid)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Alert Xóa Nhóm */}
      <AlertDialog open={!!groupToDelete} onOpenChange={(isOpen) => !isOpen && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bạn có chắc chắn muốn xóa nhóm?</AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này sẽ ẩn nhóm <strong className="text-foreground">{groupToDelete?.name}</strong> khỏi danh sách quản lý. Dữ liệu thành viên và trận đấu sẽ được lưu trữ an toàn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGroup}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Xóa nhóm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

export default Groups;
