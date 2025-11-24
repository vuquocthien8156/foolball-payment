import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Bell,
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
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth, signOut } from "firebase/auth";
import { toast } from "@/hooks/use-toast";
import { useUserRoles } from "@/hooks/useUserRoles";

const AdminLayout = () => {
  const { user } = useAuth();
  const { roles, tabs, loading: rolesLoading } = useUserRoles(user?.uid);
  const isSuperAdmin = roles.includes("superadmin");
  const allowedTabs = useMemo(
    () =>
      new Set(
        isSuperAdmin
          ? ["dashboard", "matches", "members", "scoring", "live", "public"]
          : tabs
      ),
    [isSuperAdmin, tabs]
  );
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);

  interface Notification {
    id: string;
    message: string;
    matchId: string;
    shareId: string;
    isRead: boolean;
    createdAt: Timestamp;
  }

  useEffect(() => {
    const q = query(
      collection(db, "notifications"),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const notifs = querySnapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          } as Notification)
      );
      setNotifications(notifs);
      setUnreadCount(notifs.filter((n) => !n.isRead).length);
    });

    return () => unsubscribe();
  }, []);

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      const notifRef = doc(db, "notifications", notification.id);
      await updateDoc(notifRef, { isRead: true });
    }
    navigate(
      `/admin/dashboard?matchId=${notification.matchId}&shareId=${notification.shareId}`
    );
  };

  const timeSince = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " năm trước";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " tháng trước";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " ngày trước";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " giờ trước";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " phút trước";
    return Math.floor(seconds) + " giây trước";
  };

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
    if (rolesLoading) return;

    const currentPath = window.location.pathname;
    if (currentPath === "/admin" || currentPath === "/admin/") {
      const tabRoutes = [
        { key: "dashboard", path: "/admin/dashboard" },
        { key: "matches", path: "/admin/matches" },
        { key: "members", path: "/admin/members" },
        { key: "scoring", path: "/admin/scoring" },
        { key: "live", path: "/admin/live" },
        { key: "public", path: "/public" },
      ];

      const firstAvailableTab = tabRoutes.find(
        (tab) => isSuperAdmin || allowedTabs.has(tab.key)
      );

      if (firstAvailableTab) {
        navigate(firstAvailableTab.path, { replace: true });
      }
    }
  }, [rolesLoading, isSuperAdmin, allowedTabs, navigate]);

  return (
    <div
      className={cn(
        "grid h-screen w-full overflow-hidden",
        isSidebarOpen
          ? "md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]"
          : "md:grid-cols-[0px_1fr]"
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
          "fixed inset-y-0 left-0 w-64 md:static md:w-64 lg:w-72 shadow-lg md:shadow-none"
        )}
      >
        <div className="flex h-full flex-col gap-2">
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <NavLink
              to="/admin"
              className="flex items-center gap-2 font-semibold"
            >
              <BarChart className="h-6 w-6" />
              <span className="hidden md:inline">Football Tools</span>
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
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="ml-auto h-8 w-8 relative"
                >
                  <Bell className="h-4 w-4" />
                  <span className="sr-only">Toggle notifications</span>
                  {unreadCount > 0 && (
                    <Badge className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-1 text-xs bg-red-500 text-white">
                      {unreadCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="p-4">
                  <h4 className="font-medium leading-none">Thông báo</h4>
                  <p className="text-sm text-muted-foreground">
                    Các khoản thanh toán gần đây.
                  </p>
                </div>
                <div className="grid gap-2 p-2 max-h-96 overflow-y-auto">
                  {notifications.length > 0 ? (
                    notifications.map((notification) => (
                      <button
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          "flex items-start gap-3 rounded-lg p-3 text-left text-sm transition-all hover:bg-accent",
                          !notification.isRead && "bg-muted"
                        )}
                      >
                        {!notification.isRead && (
                          <div className="h-2 w-2 rounded-full bg-sky-500 mt-1.5 flex-shrink-0" />
                        )}
                        <div className="grid gap-1 flex-1">
                          <p className="font-medium">{notification.message}</p>
                          <p className="text-xs text-muted-foreground">
                            {timeSince(notification.createdAt.toDate())}
                          </p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      Không có thông báo mới.
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex-1">
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
              {(isSuperAdmin || allowedTabs.has("dashboard")) && (
                <NavLink
                  to="/admin/dashboard"
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
              )}
              {(isSuperAdmin || allowedTabs.has("matches")) && (
                <>
                  <NavLink
                    to="/admin/matches"
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
                  to="/admin/members"
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
              {isSuperAdmin || allowedTabs.has("scoring") ? (
                <NavLink
                  to="/admin/scoring"
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
              {isSuperAdmin || allowedTabs.has("live") ? (
                <NavLink
                  to="/admin/live"
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
              {isSuperAdmin || allowedTabs.has("public") ? (
                <NavLink
                  to="/public"
                  onClick={() => setIsSidebarOpen(false)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
                >
                  <Globe className="h-4 w-4" />
                  Trang Public
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
                    : `Role: ${isSuperAdmin ? "Superadmin" : "Admin"}${
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
                : `Role: ${isSuperAdmin ? "Superadmin" : "Admin"}`}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
