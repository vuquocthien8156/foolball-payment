import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [members, setMembers] = useState<
    { id: string; name: string; loginEmail?: string }[]
  >([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchMembers = async () => {
      setIsLoadingMembers(true);
      try {
        const snapshot = await getDocs(collection(db, "members"));
        const list = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m: any) => m.loginEnabled);
        setMembers(list as any);
        if (list.length === 0) {
          setSelectedMemberId("");
          setEmail("");
        }
      } catch (err) {
        console.error("Fetch login members error:", err);
      } finally {
        setIsLoadingMembers(false);
      }
    };
    fetchMembers();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId) {
      toast({
        variant: "destructive",
        title: "Chọn thành viên",
        description: "Vui lòng chọn thành viên đã bật đăng nhập.",
      });
      return;
    }
    const selectedMember = members.find((m) => m.id === selectedMemberId);
    const emailToUse = selectedMember?.loginEmail || email;
    if (!emailToUse) {
      toast({
        variant: "destructive",
        title: "Thiếu email",
        description:
          "Member này chưa được bật login hoặc chưa có email lưu. Kiểm tra lại ở trang Thành viên.",
      });
      return;
    }
    setIsLoading(true);
    const auth = getAuth();
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        emailToUse,
        password
      );
      const uid = cred.user?.uid;
      let roles: string[] = [];
      if (uid) {
        try {
          const snap = await getDoc(doc(db, "userRoles", uid));
          const data = snap.data();
          if (Array.isArray(data?.roles)) roles = data.roles;
          console.info("[Login] fetched roles", {
            uid,
            email: cred.user.email,
            roles,
            exists: snap.exists(),
          });
        } catch (err) {
          console.error("Fetch roles error:", err);
        }
      }
      const isAdmin =
        roles.includes("admin") || roles.includes("superadmin");
      navigate(isAdmin ? "/admin/dashboard" : "/public"); // Redirect based on role
    } catch (error) {
      console.error("Login error:", error);
      toast({
        variant: "destructive",
        title: "Đăng nhập thất bại",
        description: "Email hoặc mật khẩu không đúng.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Đăng nhập</CardTitle>
          <CardDescription>
            Nhập email và mật khẩu của bạn để truy cập vào trang quản trị.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label>Chọn thành viên</Label>
              <Select
                value={selectedMemberId}
                onValueChange={(value) => {
                  setSelectedMemberId(value);
                  const member = members.find((m) => m.id === value);
                  setEmail(member?.loginEmail || "");
                }}
                disabled={isLoadingMembers || members.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isLoadingMembers
                        ? "Đang tải..."
                        : members.length === 0
                        ? "Chưa có member bật login - nhập email thủ công"
                        : "Chọn thành viên được bật đăng nhập"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                  {members.length === 0 && !isLoadingMembers && (
                    <SelectItem value="none" disabled>
                      Chưa bật đăng nhập cho thành viên nào
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Đăng nhập
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default Login;
