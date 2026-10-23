import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { PlatformAccount } from "@/hooks/usePlatformAccount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
const PlatformAccounts = () => {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetUid, setResetUid] = useState<string | null>(null);
  const [createdAccount, setCreatedAccount] = useState<{ email: string } | null>(null);
  const loadAccounts = async () => {
    try { setAccounts(await apiRequest("GET", "/platform/accounts")); }
    catch { toast({ variant: "destructive", title: "Không thể tải tài khoản" }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadAccounts(); }, []);
  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const created = await apiRequest("POST", "/platform/accounts", { email: email.trim(), displayName: displayName.trim(), password });
      setCreatedAccount({ email: created.email }); setOpen(false); setEmail(""); setDisplayName("");
      await loadAccounts();
    } catch (error) { toast({ variant: "destructive", title: "Không thể tạo tài khoản", description: error instanceof Error ? error.message : undefined }); }
    finally { setPassword(""); setBusy(false); }
  };
  const handleStatus = async (account: Pick<PlatformAccount, "uid" | "status">) => {
    setBusy(true);
    try { await apiRequest("PATCH", `/platform/accounts/${account.uid}`, { status: account.status === "active" ? "disabled" : "active" }); await loadAccounts(); }
    catch { toast({ variant: "destructive", title: "Không thể cập nhật tài khoản" }); }
    finally { setBusy(false); }
  };
  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await apiRequest("POST", `/platform/accounts/${resetUid}/password`, { password }); setResetUid(null); toast({ title: "Đã đổi mật khẩu" }); }
    catch { toast({ variant: "destructive", title: "Không thể đổi mật khẩu" }); }
    finally { setPassword(""); setBusy(false); }
  };
  const loginUrl = `${window.location.origin}/platform/login`;
  const copyValue = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast({ title: "Đã sao chép" }); }
    catch { toast({ variant: "destructive", title: "Không thể sao chép" }); }
  };
  return <main className="container max-w-5xl py-8 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><Link to="/platform" className="text-sm underline">Nhóm của tôi</Link><h1 className="text-2xl font-bold">Tài khoản nền tảng</h1></div><Button onClick={() => { setPassword(""); setOpen(true); }}>Tạo tài khoản</Button></div>
    {createdAccount && <section className="rounded-lg border p-4 space-y-4" aria-label="Thông tin đăng nhập">
      <p>Gửi đường dẫn và email cho người dùng. Chia sẻ mật khẩu riêng.</p>
      <div className="space-y-2"><p className="text-sm font-medium">Đường dẫn đăng nhập</p><a href={loginUrl} className="block break-all text-sm text-primary underline">{loginUrl}</a><Button variant="outline" onClick={() => copyValue(loginUrl)}>Sao chép link đăng nhập</Button></div>
      <div className="space-y-2"><p className="text-sm font-medium">Email đăng nhập</p><p className="break-all font-mono text-sm">{createdAccount.email}</p><Button variant="outline" onClick={() => copyValue(createdAccount.email)}>Sao chép email</Button></div>
    </section>}
    {loading ? <p role="status">Đang tải…</p> : <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Tên</TableHead><TableHead>Vai trò</TableHead><TableHead>Trạng thái</TableHead><TableHead>Ngày tạo</TableHead><TableHead>Hành động</TableHead></TableRow></TableHeader><TableBody>{accounts.map((account) => <TableRow key={account.uid}><TableCell>{account.email}</TableCell><TableCell>{account.displayName}</TableCell><TableCell>{account.role === "owner" ? "Chủ nền tảng" : "Người dùng"}</TableCell><TableCell>{account.status === "active" ? "Hoạt động" : "Đã khóa"}</TableCell><TableCell>{account.createdAt ? new Date((account.createdAt._seconds ?? account.createdAt.seconds ?? 0) * 1000).toLocaleDateString("vi-VN") : "—"}</TableCell><TableCell>{account.role !== "owner" && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => handleStatus(account)}>{account.status === "active" ? "Khóa" : "Mở khóa"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { setPassword(""); setResetUid(account.uid); }}>Đổi mật khẩu</Button></div>}</TableCell></TableRow>)}</TableBody></Table></div>}
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); setPassword(""); }}><DialogContent><DialogHeader><DialogTitle>Tạo tài khoản</DialogTitle><DialogDescription>Nhập mật khẩu ban đầu và gửi riêng cho người dùng.</DialogDescription></DialogHeader><form onSubmit={handleCreate} className="space-y-4">
      <div><Label htmlFor="account-email">Email</Label><Input id="account-email" type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div><Label htmlFor="account-name">Tên hiển thị</Label><Input id="account-name" required maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
      <div><Label htmlFor="account-password">Mật khẩu ban đầu</Label><Input id="account-password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /><Button type="button" variant="ghost" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}</Button></div><Button type="submit" disabled={busy}>Tạo</Button>
    </form></DialogContent></Dialog>
    <Dialog open={resetUid !== null} onOpenChange={(value) => { if (!value) { setResetUid(null); setPassword(""); } }}><DialogContent><DialogHeader><DialogTitle>Đổi mật khẩu</DialogTitle><DialogDescription>Người dùng sẽ cần đăng nhập lại.</DialogDescription></DialogHeader><form onSubmit={handleReset} className="space-y-4"><Label htmlFor="reset-password">Mật khẩu mới</Label><Input id="reset-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /><Button type="submit" disabled={busy}>Lưu mật khẩu</Button></form></DialogContent></Dialog>
  </main>;
};
export default PlatformAccounts;
