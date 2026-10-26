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
  Repeat,
  Receipt,
  Bell,
  History,
  LayoutGrid,
  Check,
  ChevronsUpDown,
  Building2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { SPORT_LABELS, GroupSport } from "@/lib/groups";
import { apiRequest } from "@/lib/api";
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

interface PlatformGroup {
  id: string;
  name: string;
  sport?: string;
  kind?: string;
  status?: string;
}

const removeDiacritics = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
};

const AdminLayout = () => {
  const groupPath = useGroupPath();
  const { pathname } = useLocation();
  const isMatchesPage = pathname === groupPath("admin/matches");
  const { groupId, group, loading: groupLoading } = useGroup();
  const sharedBills = groupKindOf(group) === "shared_bills";
  const { user } = useAuth();
  const { role, isManager: isSuperAdmin, tabs, loading: rolesLoading } = useGroupRole(groupId);
  const { account } = usePlatformAccount();
  const [platformGroups, setPlatformGroups] = useState<PlatformGroup[]>([]);
  const [isGroupSwitcherOpen, setIsGroupSwitcherOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (account?.uid) {
      apiRequest("GET", "/platform/groups")
        .then((data: any) => {
          if (!cancelled && Array.isArray(data)) {
            setPlatformGroups(data.filter((g) => g.status !== "deleted"));
          }
        })
        .catch((err) => console.warn("Failed to load platform groups:", err));
    }
    return () => {
      cancelled = true;
    };
  }, [account?.uid]);

  const displayGroups = useMemo(() => {
    if (platformGroups.length > 0) return platformGroups;
    if (group && groupId) {
      return [
        {
          id: groupId,
          name: group.name || groupId,
          sport: group.sport,
          kind: group.kind,
          isTest: (group as any)?.isTest,
        },
      ];
    }
    return [];
  }, [platformGroups, group, groupId]);

  const { mainGroups, testGroups } = useMemo(() => {
    const main: any[] = [];
    const test: any[] = [];
    for (const g of displayGroups) {
      const name = (g.name || "").toLowerCase();
      const id = (g.id || "").toLowerCase();
      const isTest =
        typeof g.isTest === "boolean"
          ? g.isTest
          : name.startsWith("[test]") ||
            name.includes("(test)") ||
            id.startsWith("test-") ||
            id.includes("-test") ||
            id === "test";
      if (isTest) {
        test.push(g);
      } else {
        main.push(g);
      }
    }
    return { mainGroups: main, testGroups: test };
  }, [displayGroups]);

  const currentGroupInfo = useMemo(() => {
    return (
      displayGroups.find((g) => g.id === groupId) || {
        id: groupId,
        name: group?.name || groupId,
        sport: group?.sport,
        kind: group?.kind,
      }
    );
  }, [displayGroups, groupId, group]);

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
      if (sharedBills) { if (isSuperAdmin) navigate(groupPath("admin/bills?tab=recurring"), { replace: true }); return; }
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
    <div className="grid h-screen w-full overflow-hidden md:grid-cols-[240px_1fr] lg:grid-cols-[280px_1fr]">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div
        className={cn(
          "border-r bg-background z-40 transition-transform duration-200",
          "fixed inset-y-0 left-0 w-64 shadow-lg",
          "md:static md:w-full md:shadow-none md:translate-x-0 md:z-auto",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
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
          <div className="flex-1 overflow-y-auto py-3">
            <nav className="space-y-5 px-3 text-sm font-medium lg:px-4">
              {sharedBills && isSuperAdmin ? (
                <>
                  {/* Section: Khoản thu */}
                  <div className="space-y-1">
                    <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      Khoản thu
                    </div>
                    <NavLink
                      to={groupPath("admin/bills?tab=recurring")}
                      onClick={() => setIsSidebarOpen(false)}
                      className={() =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                          pathname === groupPath("admin/bills") && (!location.search || location.search.includes("tab=recurring"))
                            ? "bg-muted text-primary font-medium"
                            : ""
                        }`
                      }
                    >
                      <Repeat className="h-4 w-4" />
                      Thu định kỳ
                    </NavLink>
                    <NavLink
                      to={groupPath("admin/bills?tab=monthly")}
                      onClick={() => setIsSidebarOpen(false)}
                      className={() =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                          pathname === groupPath("admin/bills") && location.search.includes("tab=monthly")
                            ? "bg-muted text-primary font-medium"
                            : ""
                        }`
                      }
                    >
                      <Receipt className="h-4 w-4" />
                      Kỳ thu & Một lần
                    </NavLink>
                    <NavLink
                      to={groupPath("admin/bill-history")}
                      onClick={() => setIsSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                          isActive ? "bg-muted text-primary font-medium" : ""
                        }`
                      }
                    >
                      <History className="h-4 w-4" />
                      Lịch sử thanh toán
                    </NavLink>
                  </div>

                  {/* Section: Tự động hoá */}
                  <div className="space-y-1">
                    <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      Tự động hoá
                    </div>
                    <NavLink
                      to={groupPath("admin/bills?tab=reminders")}
                      onClick={() => setIsSidebarOpen(false)}
                      className={() =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                          pathname === groupPath("admin/bills") && location.search.includes("tab=reminders")
                            ? "bg-muted text-primary font-medium"
                            : ""
                        }`
                      }
                    >
                      <Bell className="h-4 w-4" />
                      Nhắc nợ tự động
                    </NavLink>
                  </div>
                </>
              ) : null}

              {!sharedBills && (
                <div className="space-y-1">
                  <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                    Hoạt động
                  </div>
                  {(isSuperAdmin || allowedTabs.has("matches")) && (
                    <NavLink
                      to={groupPath("admin/matches")}
                      onClick={() => setIsSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                          isActive ? "bg-muted text-primary" : ""
                        }`
                      }
                    >
                      <Trophy className="h-4 w-4" />
                      Quản lý Trận đấu
                    </NavLink>
                  )}
                  {!groupLoading && hasFeature(groupId, group, "scoring") && (isSuperAdmin || allowedTabs.has("scoring")) ? (
                    <NavLink
                      to={groupPath("admin/scoring")}
                      onClick={() => setIsSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
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
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                          isActive ? "bg-muted text-primary" : ""
                        }`
                      }
                    >
                      <Activity className="h-4 w-4" />
                      Ghi chú live
                    </NavLink>
                  ) : null}
                </div>
              )}

              {/* Section: Quản lý nhóm */}
              <div className="space-y-1">
                <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  Quản lý nhóm
                </div>
                {isSuperAdmin || allowedTabs.has("members") ? (
                  <NavLink
                    to={groupPath("admin/members")}
                    onClick={() => setIsSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                        isActive ? "bg-muted text-primary" : ""
                      }`
                    }
                  >
                    <Users className="h-4 w-4" />
                    Thành viên
                  </NavLink>
                ) : null}
                {isSuperAdmin || allowedTabs.has("public") ? (
                  <NavLink
                    to={groupPath("public")}
                    onClick={() => setIsSidebarOpen(false)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary"
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
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                        isActive ? "bg-muted text-primary" : ""
                      }`
                    }
                  >
                    <Settings className="h-4 w-4" />
                    Cấu hình
                  </NavLink>
                ) : null}
              </div>

              {/* Section: Hệ thống (nếu có tài khoản platform) */}
              {account ? (
                <div className="space-y-1 pt-2 border-t">
                  <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                    Hệ thống
                  </div>
                  <NavLink
                    to="/platform"
                    onClick={() => setIsSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted/60 hover:text-primary ${
                        isActive ? "bg-muted text-primary font-medium" : ""
                      }`
                    }
                  >
                    <LayoutGrid className="h-4 w-4" />
                    Nền tảng
                  </NavLink>
                </div>
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
          <div className="flex items-center justify-between p-3 sm:p-4 lg:px-6">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                className="shrink-0 md:hidden"
                aria-label="Mở menu"
              >
                <Menu className="h-5 w-5" />
              </Button>

              {/* Quick Group Switcher Combobox with Search */}
              {displayGroups.length > 0 && (
                <Popover
                  open={isGroupSwitcherOpen}
                  onOpenChange={setIsGroupSwitcherOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={isGroupSwitcherOpen}
                      className="h-9 px-2.5 sm:px-3 text-xs sm:text-sm font-medium justify-between min-w-[150px] max-w-[210px] sm:max-w-[300px] bg-background hover:bg-accent/60 border-muted-foreground/20 shadow-sm"
                    >
                      <div className="flex items-center gap-1.5 sm:gap-2 truncate min-w-0">
                        <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{currentGroupInfo.name}</span>
                        {(typeof currentGroupInfo.isTest === "boolean"
                          ? currentGroupInfo.isTest
                          : (currentGroupInfo.name || "").toLowerCase().startsWith("[test]") ||
                            (currentGroupInfo.name || "").toLowerCase().includes("(test)") ||
                            (currentGroupInfo.id || "").toLowerCase().startsWith("test-") ||
                            (currentGroupInfo.id || "").toLowerCase().includes("-test") ||
                            (currentGroupInfo.id || "").toLowerCase() === "test") && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-normal px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 shrink-0"
                          >
                            Test
                          </Badge>
                        )}
                      </div>
                      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[280px] sm:w-[320px] p-0"
                    align="start"
                  >
                    <Command
                      filter={(value, search) => {
                        const v = removeDiacritics(value.toLowerCase());
                        const s = removeDiacritics(search.toLowerCase());
                        return v.includes(s) ? 1 : 0;
                      }}
                    >
                      <CommandInput placeholder="Tìm kiếm nhóm..." />
                      <CommandList>
                        <CommandEmpty>Không tìm thấy nhóm.</CommandEmpty>
                        {mainGroups.length > 0 && (
                          <CommandGroup heading="Nhóm chính">
                            {mainGroups.map((g) => {
                              const isCurrent = g.id === groupId;
                              const sportLabel = g.sport
                                ? SPORT_LABELS[g.sport as GroupSport] || g.sport
                                : g.kind === "shared_bills"
                                ? "Chia tiền"
                                : "Thể thao";
                              return (
                                <CommandItem
                                  key={g.id}
                                  value={`${g.name} ${g.id} ${sportLabel}`}
                                  onSelect={() => {
                                    setIsGroupSwitcherOpen(false);
                                    if (!isCurrent) {
                                      try {
                                        localStorage.setItem(
                                          "lastActiveGroupId",
                                          g.id,
                                        );
                                      } catch {}
                                      navigate(`/g/${g.id}/admin`);
                                    }
                                  }}
                                  className="flex items-center justify-between py-2 px-2.5 cursor-pointer"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Check
                                      className={cn(
                                        "h-4 w-4 shrink-0 text-primary",
                                        isCurrent ? "opacity-100" : "opacity-0",
                                      )}
                                    />
                                    <div className="flex flex-col min-w-0">
                                      <span
                                        className={cn(
                                          "truncate text-sm",
                                          isCurrent && "font-semibold text-primary",
                                        )}
                                      >
                                        {g.name}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground truncate">
                                        @{g.id}
                                      </span>
                                    </div>
                                  </div>
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] font-normal px-1.5 py-0.5 shrink-0 ml-2"
                                  >
                                    {sportLabel}
                                  </Badge>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        )}
                        {testGroups.length > 0 && (
                          <>
                            {mainGroups.length > 0 && <CommandSeparator />}
                            <CommandGroup heading="Nhóm thử nghiệm (Test)">
                              {testGroups.map((g) => {
                                const isCurrent = g.id === groupId;
                                const sportLabel = g.sport
                                  ? SPORT_LABELS[g.sport as GroupSport] || g.sport
                                  : g.kind === "shared_bills"
                                  ? "Chia tiền"
                                  : "Thể thao";
                                return (
                                  <CommandItem
                                    key={g.id}
                                    value={`${g.name} ${g.id} ${sportLabel} test thu nghiem`}
                                    onSelect={() => {
                                      setIsGroupSwitcherOpen(false);
                                      if (!isCurrent) {
                                        try {
                                          localStorage.setItem(
                                            "lastActiveGroupId",
                                            g.id,
                                          );
                                        } catch {}
                                        navigate(`/g/${g.id}/admin`);
                                      }
                                    }}
                                    className="flex items-center justify-between py-2 px-2.5 cursor-pointer"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Check
                                        className={cn(
                                          "h-4 w-4 shrink-0 text-primary",
                                          isCurrent ? "opacity-100" : "opacity-0",
                                        )}
                                      />
                                      <div className="flex flex-col min-w-0">
                                        <span
                                          className={cn(
                                            "truncate text-sm",
                                            isCurrent && "font-semibold text-primary",
                                          )}
                                        >
                                          {g.name}
                                        </span>
                                        <span className="text-[11px] text-muted-foreground truncate">
                                          @{g.id}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0 ml-2">
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] font-normal px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                                      >
                                        Test
                                      </Badge>
                                      <Badge
                                        variant="secondary"
                                        className="text-[10px] font-normal px-1.5 py-0.5"
                                      >
                                        {sportLabel}
                                      </Badge>
                                    </div>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </>
                        )}
                        {account && (
                          <>
                            <CommandSeparator />
                            <CommandGroup>
                              <CommandItem
                                value="quan ly tat ca nhom nen tang platform"
                                onSelect={() => {
                                  setIsGroupSwitcherOpen(false);
                                  navigate("/platform");
                                }}
                                className="flex items-center gap-2 text-xs text-muted-foreground py-2 cursor-pointer"
                              >
                                <LayoutGrid className="h-3.5 w-3.5" />
                                <span>Quản lý tất cả nhóm (Nền tảng)</span>
                              </CommandItem>
                            </CommandGroup>
                          </>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="text-xs sm:text-sm text-muted-foreground truncate ml-2">
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
