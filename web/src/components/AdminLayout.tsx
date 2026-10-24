import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Home,
  Users,
  PlusCircle,
  LogOut,
  BarChart,
  Globe,
  Trophy,
  ClipboardCheck,
  Activity,
  Menu,
  Settings,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth, signOut } from "firebase/auth";
import { toast } from "@/hooks/use-toast";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { hasFeature } from "@/lib/features";
import { groupKindOf } from "@/lib/groups";
import { useGroupRole } from "@/hooks/useGroupRole";
import { usePlatformAccount } from "@/hooks/usePlatformAccount";

const AdminLayout = () => {
  const groupPath = useGroupPath();
  const { pathname } = useLocation();
  const isMatchesPage = pathname === groupPath("admin/matches");
  const { groupId, group, loading: groupLoading } = useGroup();
  const sharedBills = groupKindOf(group) === "shared_bills";
  const { user } = useAuth();
  const { role, isManager: isSuperAdmin, tabs, loading: rolesLoading } = useGroupRole(groupId);
  const { account } = usePlatformAccount();
  const allowedTabs = useMemo(
    () =>
      new Set(
        isSuperAdmin
          ? ["dashboard", "matches", "members", "scoring", "live", "public"]
          : tabs,
      ),
    [isSuperAdmin, tabs],
  );
  const navigate = useNavigate();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);

  const handleSignOut = async () => {
    const auth = getAuth();
    try {
      await signOut(auth);
      toast({ title: "Đã đăng xuất thành công." });
      // The ProtectedRoute component will handle the redirect.
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể đăng xuất.",
      });
    }
  };

  // Auto-redirect to first available tab
  useEffect(() => {
    if (rolesLoading || groupLoading) return;

    const currentPath = window.location.pathname;
    if (currentPath === groupPath("admin") || currentPath === groupPath("admin/")) {
      if (sharedBills) { if (isSuperAdmin) navigate(groupPath("admin/bills"), { replace: true }); return; }
      const tabRoutes = [
        { key: "matches", path: groupPath("admin/matches") },
        { key: "members", path: groupPath("admin/members") },
        { key: "scoring", path: groupPath("admin/scoring") },
        { key: "live", path: groupPath("admin/live") },
        { key: "public", path: groupPath("public") },
      ];

      const firstAvailableTab = tabRoutes.find(
        (tab) => (isSuperAdmin || allowedTabs.has(tab.key)) &&
          (tab.key !== "scoring" || hasFeature(groupId, group, "scoring")) &&
          (tab.key !== "live" || hasFeature(groupId, group, "liveNotes")),
      );

      if (firstAvailableTab) {
        navigate(firstAvailableTab.path, { replace: true });
      }
    }
  }, [rolesLoading, isSuperAdmin, allowedTabs, navigate, groupPath, groupLoading, groupId, group, sharedBills]);

  return (
    <div
      className={cn(
        "grid h-screen w-full overflow-hidden",
        isSidebarOpen
          ? "md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]"
          : "md:grid-cols-[0px_1fr]",
      )}
    >
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div
        className={cn(
          "border-r bg-background z-40 transform transition-transform duration-200",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          "fixed inset-y-0 left-0 w-64 md:static md:w-64 lg:w-72 shadow-lg md:shadow-none",
        )}
      >
        <div className="flex h-full flex-col gap-2">
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <NavLink
              to={groupPath("admin")}
              className="flex items-center gap-2 font-semibold"
            >
              <BarChart className="h-6 w-6" />
              <span className="hidden md:inline">{group?.name || "Nhóm"}</span>
            </NavLink>
            <div className="md:hidden ml-auto">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Đóng menu"
              >
                ✕
              </Button>
            </div>

          </div>
          <div className="flex-1">
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
              {/* {(isSuperAdmin || allowedTabs.has("dashboard")) && (
                <NavLink
                  to={groupPath("admin/dashboard")}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                      isActive ? "bg-muted text-primary" : ""
                    }`
                  }
                >
                  <Home className="h-4 w-4" />
                  Dashboard
                </NavLink>
              )} */}
              {account && <NavLink to="/platform" className="text-sm underline">Nền tảng</NavLink>}
              {sharedBills && isSuperAdmin ? <>
                <NavLink to={groupPath("admin/bills")} className="rounded-md px-3 py-2">Khoản thu</NavLink>
                <NavLink to={groupPath("admin/bill-history")} className="rounded-md px-3 py-2">Lịch sử</NavLink>
              </> : null}
              {!sharedBills && (isSuperAdmin || allowedTabs.has("matches")) && (
                <>
                  <NavLink
                    to={groupPath("admin/matches")}
                    onClick={() => setIsSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                        isActive ? "bg-muted text-primary" : ""
                      }`
                    }
                  >
                    <Trophy className="h-4 w-4" />
                    Quản lý Trận đấu
                  </NavLink>
                </>
              )}
              {isSuperAdmin || allowedTabs.has("members") ? (
                <NavLink
                  to={groupPath("admin/members")}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                      isActive ? "bg-muted text-primary" : ""
                    }`
                  }
                >
                  <Users className="h-4 w-4" />
                  Thành viên
                </NavLink>
              ) : null}
              {!groupLoading && hasFeature(groupId, group, "scoring") && (isSuperAdmin || allowedTabs.has("scoring")) ? (
                <NavLink
                  to={groupPath("admin/scoring")}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                      isActive ? "bg-muted text-primary" : ""
                    }`
                  }
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Chấm điểm
                </NavLink>
              ) : null}
              {!groupLoading && hasFeature(groupId, group, "liveNotes") && (isSuperAdmin || allowedTabs.has("live")) ? (
                <NavLink
                  to={groupPath("admin/live")}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                      isActive ? "bg-muted text-primary" : ""
                    }`
                  }
                >
                  <Activity className="h-4 w-4" />
                  Ghi chú live
                </NavLink>
              ) : null}
              {(isSuperAdmin || allowedTabs.has("public")) ? (
                <NavLink
                  to={groupPath("public")}
                  onClick={() => setIsSidebarOpen(false)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
                >
                  <Globe className="h-4 w-4" />
                  Trang Public
                </NavLink>
              ) : null}
              {isSuperAdmin || allowedTabs.has("members") ? (
                <NavLink
                  to={groupPath("admin/config")}
                  onClick={() => setIsSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary ${
                      isActive ? "bg-muted text-primary" : ""
                    }`
                  }
                >
                  <Settings className="h-4 w-4" />
                  Cấu hình
                </NavLink>
              ) : null}
            </nav>
          </div>
          <div className="mt-auto p-4">
            <Card>
              <CardHeader className="p-2 pt-0 md:p-4">
                <CardTitle className="break-words">{user?.email}</CardTitle>
                {/* <CardDescription>
                  {rolesLoading
                    ? "Đang tải vai trò..."
                    : `Role: ${role === "owner" ? "Owner" : isSuperAdmin ? "Manager" : "Admin"}${
                        !isSuperAdmin && tabs.length > 0
                          ? ` • Tabs: ${tabs.join(", ")}`
                          : ""
                      }`}
                </CardDescription> */}
              </CardHeader>
              <CardContent className="p-2 pt-0 md:p-4 md:pt-0">
                <Button size="sm" className="w-full" onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Đăng xuất
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <div className="flex flex-col h-screen overflow-hidden">
        <header className="sticky top-0 z-20 bg-background border-b">
          <div className="flex items-center justify-between p-4 lg:p-6">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="text-sm text-muted-foreground">
              {rolesLoading
                ? "Đang tải vai trò..."
                : `Vai trò: ${role === "owner" ? "Chủ nhóm" : isSuperAdmin ? "Quản lý" : "Quản trị viên"}`}
            </div>
          </div>
        </header>
        <main className={cn("min-h-0 flex-1 p-4 lg:p-6", isMatchesPage ? "overflow-hidden" : "overflow-y-auto")}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
