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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
type Group = { id: string; name: string; sport: GroupSport; status: string; role: string };
const Groups = () => {
  const navigate = useNavigate();
  const { account } = usePlatformAccount();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sport, setSport] = useState<GroupSport | "">("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    apiRequest("GET", "/platform/groups").then((data) => { if (!cancelled) setGroups(data); })
      .catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sport || name.trim().length < 2) { toast({ variant: "destructive", title: "Nhập tên nhóm và chọn môn thể thao" }); return; }
    setBusy(true);
    try { const created = await apiRequest("POST", "/platform/groups", { name: name.trim(), sport }); navigate(groupPath(created.id, "admin")); }
    catch { toast({ variant: "destructive", title: "Không thể tạo nhóm", description: "Vui lòng thử lại." }); }
    finally { setBusy(false); }
  };
  return <main className="container max-w-5xl py-8 space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Nhóm của tôi</h1><p className="text-muted-foreground">{account?.displayName || account?.email}</p></div><nav className="flex flex-wrap gap-2" aria-label="Nền tảng">{account?.role === "owner" && <Button asChild variant="outline"><Link to="/platform/accounts">Tài khoản</Link></Button>}<Button onClick={() => setOpen(true)}>Tạo nhóm</Button><Button variant="ghost" onClick={async () => { await signOut(auth); navigate("/platform/login"); }}>Đăng xuất</Button></nav></header>
    {loading ? <p role="status">Đang tải nhóm…</p> : error ? <p role="alert">Không thể tải nhóm. Vui lòng tải lại trang.</p> : groups.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Bạn chưa có nhóm nào. Tạo nhóm để bắt đầu.</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{groups.map((group) => <Card key={group.id}><CardHeader><CardTitle className="break-words">{group.name}</CardTitle></CardHeader><CardContent className="space-y-3"><p><span className="rounded-full bg-secondary px-2 py-1 text-sm">{SPORT_LABELS[group.sport] || SPORT_LABELS.other}</span></p><p className="text-sm text-muted-foreground">{group.role === "owner" ? "Chủ nền tảng" : group.role === "manager" ? "Quản lý" : "Quản trị viên"}{group.status === "archived" ? " · Đã lưu trữ" : ""}</p><Button asChild variant="outline"><Link to={groupPath(group.id, "admin")}>Mở nhóm</Link></Button></CardContent></Card>)}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Tạo nhóm</DialogTitle><DialogDescription>Chọn tên và môn thể thao cho nhóm mới.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={handleCreate}><div><Label htmlFor="group-name">Tên nhóm</Label><Input id="group-name" required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label htmlFor="group-sport">Môn thể thao</Label><Select value={sport} onValueChange={(value: GroupSport) => setSport(value)} required><SelectTrigger id="group-sport"><SelectValue placeholder="Chọn môn thể thao" /></SelectTrigger><SelectContent>{GROUP_SPORTS.map((value) => <SelectItem key={value} value={value}>{SPORT_LABELS[value]}</SelectItem>)}</SelectContent></Select></div><Button disabled={busy || !sport} type="submit">{busy ? "Đang tạo…" : "Tạo nhóm"}</Button></form></DialogContent></Dialog>
  </main>;
};
export default Groups;
