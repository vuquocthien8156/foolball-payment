import { useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "@/lib/firebase";
import { apiRequest } from "@/lib/api";
import { groupPath } from "@/lib/groups";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
const PlatformLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      const account = await apiRequest("GET", "/platform/me");
      const groups: { id: string }[] = await apiRequest("GET", "/platform/groups");
      navigate(account.role === "user" && groups.length === 1 ? groupPath(groups[0].id, "admin") : "/platform");
    } catch (error) {
      if (error instanceof Error && error.message === "PLATFORM_ACCESS_DENIED") {
        await signOut(auth);
        toast({ variant: "destructive", title: "Tài khoản không có quyền truy cập nền tảng" });
      } else toast({ variant: "destructive", title: "Không thể đăng nhập", description: "Kiểm tra email, mật khẩu và thử lại." });
    } finally { setPassword(""); setBusy(false); }
  };
  return <main className="min-h-screen flex items-center justify-center p-4 bg-background"><Card className="w-full max-w-md">
    <CardHeader><CardTitle>Đăng nhập nền tảng</CardTitle><CardDescription>Dùng tài khoản do quản trị viên nền tảng cấp.</CardDescription></CardHeader>
    <CardContent><form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="platform-email">Email</Label><Input id="platform-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="platform-password">Mật khẩu</Label><Input id="platform-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <Button className="w-full" disabled={busy} type="submit">{busy ? "Đang đăng nhập…" : "Đăng nhập"}</Button>
    </form></CardContent>
  </Card></main>;
};
export default PlatformLogin;
