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
import { Loader2, Check, ChevronsUpDown } from "lucide-react";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [members, setMembers] = useState<
    { id: string; name: string; loginEmail?: string }[]
  >([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [popoverOpen, setPopoverOpen] = useState(false);
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
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={popoverOpen}
                    className="w-full justify-between font-normal"
                    disabled={isLoadingMembers || members.length === 0}
                  >
                    {selectedMemberId
                      ? members.find((m) => m.id === selectedMemberId)?.name
                      : isLoadingMembers
                      ? "Đang tải..."
                      : members.length === 0
                      ? "Chưa có member bật login - nhập email thủ công"
                      : "Chọn thành viên được bật đăng nhập"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Tìm thành viên..." />
                    <CommandList>
                      <CommandEmpty>Không tìm thấy thành viên.</CommandEmpty>
                      <CommandGroup>
                        {members.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={m.name}
                            onSelect={() => {
                              setSelectedMemberId(m.id);
                              setEmail(m.loginEmail || "");
                              setPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedMemberId === m.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            {m.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
