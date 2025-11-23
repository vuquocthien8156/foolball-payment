import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ClipboardCheck,
  LogOut,
  Home,
  Trophy,
  Menu,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getAuth, signOut } from "firebase/auth";
import { toast } from "@/hooks/use-toast";

const ScoringLayout = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [navigate]);

  const handleSignOut = async () => {
    const auth = getAuth();
    try {
      await signOut(auth);
      toast({ title: "Đã đăng xuất." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể đăng xuất.",
      });
    }
  };

  const navLinks = [
    {
      to: "/scoring",
      icon: Home,
      label: "Trang chủ",
    },
    {
      to: "/scoring/matches",
      icon: Trophy,
      label: "Chấm điểm trận",
    },
  ];

  return (
    <div className="grid h-screen w-full overflow-hidden md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr]">
      <div className="md:hidden p-3 border-b flex items-center justify-between bg-background">
        <div className="flex items-center gap-2 font-semibold">
          <ClipboardCheck className="h-5 w-5" />
          Scoring Admin
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileNavOpen((p) => !p)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>
      <div
        className={cn(
          "border-r bg-muted/40 p-4 space-y-4",
          isMobileNavOpen ? "block" : "hidden md:block"
        )}
      >
        <div className="flex items-center gap-2 font-semibold px-2">
          <ClipboardCheck className="h-5 w-5" />
          <div className="leading-tight">
            <div>Scoring Admin</div>
            <div className="text-xs text-muted-foreground truncate max-w-[140px]">
              {user?.email}
            </div>
          </div>
        </div>
        <Card className="p-2">
          <nav className="grid gap-1">
            {navLinks.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-primary hover:bg-muted transition",
                    isActive && "bg-muted text-primary font-semibold"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </Card>
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </Button>
      </div>
      <div className="overflow-y-auto bg-background">
        <Outlet />
      </div>
    </div>
  );
};

export default ScoringLayout;
