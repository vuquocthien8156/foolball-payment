import React, { Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { PWAInstallProvider } from "./contexts/PWAInstallContext";
import { useGroupRole } from "./hooks/useGroupRole";
import { usePlatformAccount } from "./hooks/usePlatformAccount";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { GroupProvider, useGroup, useGroupPath } from "./contexts/GroupContext";
import { DEFAULT_GROUP_ID, groupPath, resolveLegacyRedirect } from "./lib/groups";
import { FeatureKey, hasFeature } from "./lib/features";

// Lazy load components
const AdminLayout = React.lazy(() => import("./components/AdminLayout"));
const Members = React.lazy(() => import("./pages/Members"));
const SetupMatch = React.lazy(() => import("./pages/SetupMatch"));
const Pay = React.lazy(() => import("./pages/Pay"));
const PaymentSuccess = React.lazy(() => import("./pages/PaymentSuccess"));
const PaymentCancel = React.lazy(() => import("./pages/PaymentCancel"));
const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const Login = React.lazy(() => import("./pages/Login"));
const NotFound = React.lazy(() => import("./pages/NotFound"));
const Matches = React.lazy(() => import("./pages/Matches"));
const Attendance = React.lazy(() => import("./pages/Attendance"));
const TeamLocked = React.lazy(() => import("./pages/TeamLocked"));
const PublicPortal = React.lazy(() => import("./pages/PublicPortal"));
const PublicRatings = React.lazy(() => import("./pages/PublicRatings"));
const ScoringMatches = React.lazy(() => import("./pages/ScoringMatches"));
const LiveNotes = React.lazy(() => import("./pages/LiveNotes"));
const Config = React.lazy(() => import("./pages/Config"));
const Groups = React.lazy(() => import("./pages/Groups"));
const PlatformLogin = React.lazy(() => import("./pages/PlatformLogin"));
const PlatformAccounts = React.lazy(() => import("./pages/PlatformAccounts"));

const queryClient = new QueryClient();

const LoadingSplash = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
  </div>
);

export const PlatformRoute = ({ ownerOnly = false, children }: { ownerOnly?: boolean; children: JSX.Element }) => {
  const { user } = useAuth();
  const { account, loading } = usePlatformAccount();
  useEffect(() => {
    if (user && !loading && !account) void signOut(auth);
  }, [user, loading, account]);
  if (!user) return <Navigate to="/platform/login" replace />;
  if (loading) return <LoadingSplash />;
  if (!account) return <p role="alert" className="p-6">Tài khoản không có quyền truy cập nền tảng. Đang đăng xuất…</p>;
  if (ownerOnly && account.role !== "owner") return <Navigate to="/platform" replace />;
  return children;
};

const AdminProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const groupPath = useGroupPath();
  const { user } = useAuth();
  const { groupId } = useGroup();
  const { role, loading } = useGroupRole(groupId);

  if (!user) return <Navigate to="/platform/login" replace />;
  if (loading) return <LoadingSplash />;

  const canAccess = role !== null;
  if (!canAccess) return <Navigate to={groupPath("public")} replace />;
  return children;
};

const TabGuard = ({
  tabKey,
  children,
}: {
  tabKey: string;
  children: JSX.Element;
}) => {
  const groupPath = useGroupPath();
  const { groupId } = useGroup();
  const { isManager, tabs, loading } = useGroupRole(groupId);
  if (loading) return <LoadingSplash />;
  const allowed = isManager || tabs.includes(tabKey);
  return allowed ? children : <Navigate to={groupPath("admin")} replace />;
};

const AdminHomeRedirect = () => {
  const groupPath = useGroupPath();
  const { groupId, group, loading: groupLoading } = useGroup();
  const { isManager, tabs, loading } = useGroupRole(groupId);
  if (loading || groupLoading) return <LoadingSplash />;
  if (isManager) return <Navigate to={groupPath("admin/matches")} replace />;
  const order = ["scoring", "live", "matches", "members"];
  const target = order.find((t) => tabs.includes(t) &&
    (t !== "scoring" || hasFeature(groupId, group, "scoring")) &&
    (t !== "live" || hasFeature(groupId, group, "liveNotes")));
  return target ? (
    <Navigate
      to={groupPath(`admin/${target}`)}
      replace
    />
  ) : (
    <Navigate to={groupPath("public")} replace />
  );
};

export const LegacyRedirect = () => {
  const location = useLocation();
  return <Navigate to={resolveLegacyRedirect(location.pathname, location.search) ?? groupPath(DEFAULT_GROUP_ID, "public")} replace />;
};

export const RequireFeature = ({ feature, children }: { feature: FeatureKey; children: JSX.Element }) => {
  const { groupId, group, loading } = useGroup();
  if (loading) return <LoadingSplash />;
  return hasFeature(groupId, group, feature) ? children : <NotFound />;
};

const App = () => {
  const { user, loading } = useAuth();
  const { role, loading: rolesLoading } = useGroupRole(DEFAULT_GROUP_ID);
  const { account, loading: platformLoading } = usePlatformAccount();

  if (loading || rolesLoading || platformLoading) return <LoadingSplash />;

  return (
    <PWAInstallProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<LoadingSplash />}>
              <Routes>
                <Route path="/platform/login" element={<PlatformLogin />} />
                <Route path="/platform" element={<PlatformRoute><Groups /></PlatformRoute>} />
                <Route path="/platform/accounts" element={<PlatformRoute ownerOnly><PlatformAccounts /></PlatformRoute>} />
                <Route path="/login" element={<LegacyRedirect />} />
                <Route path="/public/*" element={<LegacyRedirect />} />
                <Route path="/admin/*" element={<LegacyRedirect />} />
                <Route path="/g/:groupId" element={<GroupProvider><Outlet /></GroupProvider>}>
                <Route
                  path="login"
                  element={<Login />}
                />
                {/* Public Routes under /public */}
                <Route path="public">
                  <Route index element={<PublicPortal />} />
                  <Route path="pay" element={<Pay />} />
                  <Route path="payment-success" element={<PaymentSuccess />} />
                  <Route path="payment-cancel" element={<PaymentCancel />} />
                  <Route path="attendance" element={<Attendance />} />
                  <Route path="team-locked" element={<RequireFeature feature="teamPropose"><TeamLocked /></RequireFeature>} />
                  <Route path="ratings" element={<RequireFeature feature="ratings"><PublicRatings /></RequireFeature>} />
                </Route>

                {/* Protected Admin Routes */}
                <Route
                  path="admin"
                  element={
                    <AdminProtectedRoute>
                      <AdminLayout />
                    </AdminProtectedRoute>
                  }
                >
                  <Route index element={<AdminHomeRedirect />} />
                  {/*
                  <Route
                    path="dashboard"
                    element={
                      <TabGuard tabKey="dashboard">
                        <Dashboard />
                      </TabGuard>
                    }
                  />
                  */}
                  <Route
                    path="setup"
                    element={
                      <TabGuard tabKey="matches">
                        <SetupMatch />
                      </TabGuard>
                    }
                  />
                  <Route
                    path="setup/:matchId"
                    element={
                      <TabGuard tabKey="matches">
                        <SetupMatch />
                      </TabGuard>
                    }
                  />
                  <Route
                    path="members"
                    element={
                      <TabGuard tabKey="members">
                        <Members />
                      </TabGuard>
                    }
                  />
                  <Route
                    path="matches"
                    element={
                      <TabGuard tabKey="matches">
                        <Matches />
                      </TabGuard>
                    }
                  />
                  <Route
                    path="scoring"
                    element={
                      <TabGuard tabKey="scoring">
                        <RequireFeature feature="scoring"><ScoringMatches /></RequireFeature>
                      </TabGuard>
                    }
                  />
                  <Route
                    path="live"
                    element={
                      <TabGuard tabKey="live">
                        <RequireFeature feature="liveNotes"><LiveNotes /></RequireFeature>
                      </TabGuard>
                    }
                  />
                  <Route
                    path="config"
                    element={
                      <TabGuard tabKey="members">
                        <Config />
                      </TabGuard>
                    }
                  />
                </Route>
                </Route>

                {/* Root path redirect */}
                <Route
                  path="/"
                  element={
                    user && account ? (
                      <Navigate to="/platform" replace />
                    ) : user && role ? (
                      <Navigate to={groupPath(DEFAULT_GROUP_ID, "admin")} replace />
                    ) : (
                      <Navigate to={groupPath(DEFAULT_GROUP_ID, "public")} replace />
                    )
                  }
                />

                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </PWAInstallProvider>
  );
};

export default App;
