import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { PlatformAccount } from "@/hooks/usePlatformAccount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users, Check, Search, Pencil, X } from "lucide-react";

const PlatformAccounts = () => {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "owner">("user");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetUid, setResetUid] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<{ email: string } | null>(null);

  // Edit Account state
  const [editAccount, setEditAccount] = useState<PlatformAccount | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editRole, setEditRole] = useState<"user" | "owner">("user");
  const [editBusy, setEditBusy] = useState(false);

  // Link Members state
  const [linkingAccount, setLinkingAccount] = useState<PlatformAccount | null>(null);
  const [linkGroups, setLinkGroups] = useState<any[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [selectedMemberKeys, setSelectedMemberKeys] = useState<Set<string>>(new Set());
  const [savingLinks, setSavingLinks] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");

  const loadAccounts = async () => {
    try { setAccounts(await apiRequest("GET", "/platform/accounts")); }
    catch { toast({ variant: "destructive", title: "Không thể tải tài khoản" }); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadAccounts(); }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const created = await apiRequest("POST", "/platform/accounts", { email: email.trim(), displayName: displayName.trim(), password, role });
      setCreatedAccount({ email: created.email }); setOpen(false); setEmail(""); setDisplayName(""); setRole("user");
      await loadAccounts();
      toast({ title: "Đã tạo tài khoản thành công!" });
    } catch (error) { toast({ variant: "destructive", title: "Không thể tạo tài khoản", description: error instanceof Error ? error.message : undefined }); }
    finally { setPassword(""); setBusy(false); }
  };

  const handleStatus = async (account: Pick<PlatformAccount, "uid" | "status">) => {
    setBusy(true);
    try { await apiRequest("PATCH", `/platform/accounts/${account.uid}`, { status: account.status === "active" ? "disabled" : "active" }); await loadAccounts(); }
    catch { toast({ variant: "destructive", title: "Không thể cập nhật tài khoản" }); }
    finally { setBusy(false); }
  };

  const handleRoleChange = async (account: PlatformAccount, newRole: "user" | "owner") => {
    if (account.role === newRole) return;
    setBusy(true);
    try {
      await apiRequest("PATCH", `/platform/accounts/${account.uid}`, { role: newRole });
      await loadAccounts();
      toast({ title: `Đã cập nhật vai trò thành ${newRole === "owner" ? "Chủ nền tảng" : "Người dùng"}` });
    } catch {
      toast({ variant: "destructive", title: "Không thể đổi vai trò" });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await apiRequest("POST", `/platform/accounts/${resetUid}/password`, { password }); setResetUid(null); toast({ title: "Đã đổi mật khẩu" }); }
    catch { toast({ variant: "destructive", title: "Không thể đổi mật khẩu" }); }
    finally { setPassword(""); setBusy(false); }
  };

  const openEditModal = (account: PlatformAccount) => {
    setEditAccount(account);
    setEditDisplayName(account.displayName || "");
    setEditRole(account.role);
  };

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editAccount) return;
    const name = editDisplayName.trim();
    if (name.length < 1 || name.length > 60) {
      toast({ variant: "destructive", title: "Tên hiển thị phải từ 1 đến 60 ký tự" });
      return;
    }
    setEditBusy(true);
    try {
      await apiRequest("PATCH", `/platform/accounts/${editAccount.uid}`, {
        displayName: name,
        role: editRole,
      });
      await loadAccounts();
      toast({ title: "Đã cập nhật thông tin tài khoản thành công" });
      setEditAccount(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Không thể cập nhật tài khoản", description: err.message });
    } finally {
      setEditBusy(false);
    }
  };

  const openLinkModal = async (account: PlatformAccount) => {
    setLinkingAccount(account);
    setMemberSearchQuery("");
    setLinkLoading(true);
    try {
      const res = await apiRequest("GET", `/platform/accounts/${account.uid}/members`);
      const groups = res.groups || [];
      setLinkGroups(groups);
      const initialSelected = new Set<string>();
      groups.forEach((g: any) => {
        (g.members || []).forEach((m: any) => {
          if (m.isLinked) initialSelected.add(`${g.groupId}:${m.id}`);
        });
      });
      setSelectedMemberKeys(initialSelected);
    } catch {
      toast({ variant: "destructive", title: "Không thể tải danh sách thành viên" });
    } finally {
      setLinkLoading(false);
    }
  };

  const filteredLinkGroups = useMemo(() => {
    const q = memberSearchQuery.trim().toLowerCase();
    if (!q) return linkGroups;
    return linkGroups
      .map((grp: any) => {
        const groupMatches = grp.groupName?.toLowerCase().includes(q);
        const matchedMembers = (grp.members || []).filter((m: any) =>
          groupMatches ||
          m.name?.toLowerCase().includes(q) ||
          (m.nickname && m.nickname.toLowerCase().includes(q))
        );
        return { ...grp, members: matchedMembers };
      })
      .filter((grp: any) => grp.members && grp.members.length > 0);
  }, [linkGroups, memberSearchQuery]);

  const toggleMemberKey = (key: string) => {
    setSelectedMemberKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSaveLinks = async () => {
    if (!linkingAccount) return;
    setSavingLinks(true);
    try {
      const memberKeys = Array.from(selectedMemberKeys).map((k) => {
        const [groupId, memberId] = k.split(":");
        return { groupId, memberId };
      });
      await apiRequest("POST", `/platform/accounts/${linkingAccount.uid}/members`, { memberKeys });
      toast({
        title: "Đã lưu liên kết thành công",
        description: `Đã liên kết ${memberKeys.length} hồ sơ thành viên vào tài khoản ${linkingAccount.displayName || linkingAccount.email}.`,
      });
      setLinkingAccount(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Lỗi lưu liên kết", description: err.message });
    } finally {
      setSavingLinks(false);
    }
  };

  const loginUrl = `${window.location.origin}/platform/login`;
  const copyValue = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast({ title: "Đã sao chép" }); }
    catch { toast({ variant: "destructive", title: "Không thể sao chép" }); }
  };

  return <main className="container max-w-5xl py-8 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <Link to="/platform" className="text-sm underline">Nhóm của tôi</Link>
        <h1 className="text-2xl font-bold">Tài khoản nền tảng</h1>
      </div>
      <Button onClick={() => { setPassword(""); setRole("user"); setOpen(true); }}>Tạo tài khoản</Button>
    </div>
    {createdAccount && <section className="rounded-lg border p-4 space-y-4" aria-label="Thông tin đăng nhập">
      <p>Gửi đường dẫn và email cho người dùng. Chia sẻ mật khẩu riêng.</p>
      <div className="space-y-2"><p className="text-sm font-medium">Đường dẫn đăng nhập</p><a href={loginUrl} className="block break-all text-sm text-primary underline">{loginUrl}</a><Button variant="outline" onClick={() => copyValue(loginUrl)}>Sao chép link đăng nhập</Button></div>
      <div className="space-y-2"><p className="text-sm font-medium">Email đăng nhập</p><p className="break-all font-mono text-sm">{createdAccount.email}</p><Button variant="outline" onClick={() => copyValue(createdAccount.email)}>Sao chép email</Button></div>
    </section>}
    {loading ? <p role="status">Đang tải…</p> : <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Tên</TableHead>
            <TableHead>Vai trò</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Ngày tạo</TableHead>
            <TableHead>Hành động</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.uid}>
              <TableCell className="font-mono text-sm">{account.email}</TableCell>
              <TableCell className="font-medium">{account.displayName}</TableCell>
              <TableCell>
                {account.role === "owner" ? (
                  <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30">
                    👑 Chủ nền tảng
                  </Badge>
                ) : (
                  <Badge variant="outline">Người dùng</Badge>
                )}
              </TableCell>
              <TableCell>{account.status === "active" ? "Hoạt động" : "Đã khóa"}</TableCell>
              <TableCell>{account.createdAt ? new Date((account.createdAt._seconds ?? account.createdAt.seconds ?? 0) * 1000).toLocaleDateString("vi-VN") : "—"}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 border-indigo-200 dark:border-indigo-800"
                    onClick={() => openLinkModal(account)}
                    title="Liên kết hồ sơ thành viên ở các nhóm với tài khoản này"
                  >
                    <Users className="h-3.5 w-3.5" />
                    Liên kết thành viên
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs"
                    onClick={() => openEditModal(account)}
                    title="Chỉnh sửa thông tin tài khoản"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Sửa
                  </Button>

                  {account.role !== "owner" ? (
                    <>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleRoleChange(account, "owner")}>
                        Nâng làm Admin
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => handleStatus(account)}>
                        {account.status === "active" ? "Khóa" : "Mở khóa"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPassword(""); setResetUid(account.uid); }}>
                        Đổi mật khẩu
                      </Button>
                    </>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>}
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); setPassword(""); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo tài khoản</DialogTitle>
          <DialogDescription>Nhập mật khẩu ban đầu và gửi riêng cho người dùng.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="account-name">Tên hiển thị</Label>
            <Input id="account-name" required maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="account-role">Vai trò trên nền tảng</Label>
            <Select value={role} onValueChange={(val: "user" | "owner") => setRole(val)}>
              <SelectTrigger id="account-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Người dùng (Quản lý các nhóm được giao/tự tạo)</SelectItem>
                <SelectItem value="owner">Chủ nền tảng (Super Admin - Toàn quyền mọi nhóm & tài khoản)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="account-password">Mật khẩu ban đầu</Label>
            <Input id="account-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
            <Button type="button" variant="ghost" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            </Button>
          </div>
          <Button type="submit" disabled={busy}>Tạo</Button>
        </form>
      </DialogContent>
    </Dialog>

    {/* Edit Account Dialog */}
    <Dialog open={editAccount !== null} onOpenChange={(val) => { if (!val) setEditAccount(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Chỉnh sửa tài khoản
          </DialogTitle>
          <DialogDescription>
            Cập nhật tên hiển thị hoặc vai trò trên nền tảng cho tài khoản {editAccount?.email}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <Label htmlFor="edit-account-email">Email</Label>
            <Input id="edit-account-email" disabled value={editAccount?.email || ""} className="bg-muted text-muted-foreground" />
          </div>
          <div>
            <Label htmlFor="edit-account-name">Tên hiển thị</Label>
            <Input
              id="edit-account-name"
              required
              maxLength={60}
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              placeholder="Nhập tên hiển thị..."
            />
          </div>
          <div>
            <Label htmlFor="edit-account-role">Vai trò trên nền tảng</Label>
            <Select
              value={editRole}
              onValueChange={(val: "user" | "owner") => setEditRole(val)}
              disabled={editAccount?.role === "owner"}
            >
              <SelectTrigger id="edit-account-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Người dùng (Quản lý các nhóm được giao/tự tạo)</SelectItem>
                <SelectItem value="owner">Chủ nền tảng (Super Admin - Toàn quyền mọi nhóm & tài khoản)</SelectItem>
              </SelectContent>
            </Select>
            {editAccount?.role === "owner" && (
              <p className="text-xs text-muted-foreground mt-1">
                Tài khoản Chủ nền tảng không thể hạ cấp qua form này vì lý do bảo mật.
              </p>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setEditAccount(null)} disabled={editBusy}>
              Hủy
            </Button>
            <Button type="submit" disabled={editBusy} className="gap-1.5">
              {editBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Lưu thay đổi
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={resetUid !== null} onOpenChange={(value) => { if (!value) { setResetUid(null); setPassword(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đổi mật khẩu</DialogTitle>
          <DialogDescription>Người dùng sẽ cần đăng nhập lại.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleReset} className="space-y-4">
          <Label htmlFor="reset-password">Mật khẩu mới</Label>
          <Input id="reset-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
          <Button type="submit" disabled={busy}>Lưu mật khẩu</Button>
        </form>
      </DialogContent>
    </Dialog>

    {/* Link Members Across Groups Dialog */}
    <Dialog open={linkingAccount !== null} onOpenChange={(val) => { if (!val) setLinkingAccount(null); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            Liên kết thành viên với tài khoản: {linkingAccount?.displayName || linkingAccount?.email}
          </DialogTitle>
          <DialogDescription>
            Chọn các hồ sơ thành viên ở các nhóm thuộc về người này. Khi họ đứng ra ứng tiền sân ở bất kỳ nhóm nào, hệ thống sẽ tự động nhận diện và tính tiền cần hoàn cho họ.
          </DialogDescription>
        </DialogHeader>

        <div className="relative pt-1">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Tìm thành viên theo tên, biệt danh hoặc tên nhóm..."
            value={memberSearchQuery}
            onChange={(e) => setMemberSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {memberSearchQuery && (
            <button
              type="button"
              onClick={() => setMemberSearchQuery("")}
              className="absolute right-3 top-3.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-2 space-y-4">
          {linkLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : linkGroups.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Chưa có nhóm nào hoặc không có thành viên.</p>
          ) : filteredLinkGroups.length === 0 ? (
            <div className="text-center py-8 space-y-1">
              <p className="text-sm font-medium">Không tìm thấy thành viên phù hợp</p>
              <p className="text-xs text-muted-foreground">Không có kết quả nào khớp với "{memberSearchQuery}".</p>
            </div>
          ) : (
            filteredLinkGroups.map((grp: any) => (
              <div key={grp.groupId} className="border rounded-lg p-3 space-y-2 bg-muted/20">
                <div className="flex items-center justify-between border-b pb-1.5">
                  <span className="font-semibold text-sm text-foreground">{grp.groupName}</span>
                  <Badge variant="outline" className="text-[11px] capitalize">{grp.sport || "Nhóm"}</Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {(grp.members || []).map((m: any) => {
                    const key = `${grp.groupId}:${m.id}`;
                    const isChecked = selectedMemberKeys.has(key);
                    const isLinkedToOther = m.accountUid && m.accountUid !== linkingAccount?.uid;

                    return (
                      <label
                        key={m.id}
                        className={`flex items-center gap-2.5 p-2 rounded-md border text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-800 font-medium"
                            : isLinkedToOther
                              ? "opacity-60 bg-muted/40 border-dashed"
                              : "hover:bg-muted/50 border-border/60"
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleMemberKey(key)}
                        />
                        <span className="truncate flex-1">
                          {m.name} {m.nickname ? `(${m.nickname})` : ""}
                        </span>
                        {isLinkedToOther && (
                          <span className="text-[10px] text-muted-foreground italic shrink-0">
                            (Đã gắn tài khoản khác)
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button variant="outline" onClick={() => setLinkingAccount(null)} disabled={savingLinks}>
            Hủy
          </Button>
          <Button
            onClick={handleSaveLinks}
            disabled={savingLinks || linkLoading}
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {savingLinks ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Lưu liên kết ({selectedMemberKeys.size} thành viên)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </main>;
};
export default PlatformAccounts;
