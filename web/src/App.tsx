import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { PWAInstallProvider } from "./contexts/PWAInstallContext";
import { useUserRoles } from "./hooks/useUserRoles";

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
const PublicPortal = React.lazy(() => import("./pages/PublicPortal"));
const PublicRatings = React.lazy(() => import("./pages/PublicRatings"));
const ScoringMatches = React.lazy(() => import("./pages/ScoringMatches"));
const LiveNotes = React.lazy(() => import("./pages/LiveNotes"));

const queryClient = new QueryClient();

const LoadingSplash = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
  </div>
);

const AdminProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { user } = useAuth();
  const { roles, loading } = useUserRoles(user?.uid);

  if (!user) return <Navigate to="/login" replace />;
  if (loading) return <LoadingSplash />;

  const canAccess = roles.includes("admin") || roles.includes("superadmin");
  if (!canAccess) return <Navigate to="/public" replace />;
  return children;
};

const TabGuard = ({
  tabKey,
  children,
}: {
  tabKey: string;
  children: JSX.Element;
}) => {
  const { user } = useAuth();
  const { roles, tabs, loading } = useUserRoles(user?.uid);
  if (loading) return <LoadingSplash />;
  const isSuper = roles.includes("superadmin");
  const allowed = isSuper || tabs.includes(tabKey);
  return allowed ? children : <Navigate to="/admin/dashboard" replace />;
};

const AdminHomeRedirect = () => {
  const { user } = useAuth();
  const { roles, tabs, loading } = useUserRoles(user?.uid);
  if (loading) return <LoadingSplash />;
  const isSuper = roles.includes("superadmin");
  if (isSuper) return <Navigate to="/admin/dashboard" replace />;
  const order = ["dashboard", "scoring", "live", "matches", "members"];
  const target = order.find((t) => tabs.includes(t));
  return target ? (
    <Navigate
      to={`/admin/${target === "dashboard" ? "dashboard" : target}`}
      replace
    />
  ) : (
    <Navigate to="/public" replace />
  );
};

const PublicRoute = ({ children }: { children: JSX.Element }) => {
  const { user } = useAuth();
  const { roles, loading } = useUserRoles(user?.uid);
  if (loading) return <LoadingSplash />;
  const isAdmin = roles.includes("admin") || roles.includes("superadmin");
  if (user && isAdmin) return <Navigate to="/admin" replace />;
  return children;
};

const App = () => {
  const { user, loading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles(user?.uid);

  if (loading || rolesLoading) return <LoadingSplash />;

  return (
    <PWAInstallProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<LoadingSplash />}>
              <Routes>
                <Route
                  path="/login"
                  element={
                    <PublicRoute>
                      <Login />
                    </PublicRoute>
                  }
                />
                {/* Public Routes under /public */}
                <Route path="/public">
                  <Route index element={<PublicPortal />} />
                  <Route path="pay" element={<Pay />} />
                  <Route path="payment-success" element={<PaymentSuccess />} />
                  <Route path="payment-cancel" element={<PaymentCancel />} />
                  <Route path="attendance" element={<Attendance />} />
                  <Route path="ratings" element={<PublicRatings />} />
                </Route>

                {/* Protected Admin Routes */}
                <Route
                  path="/admin"
                  element={
                    <AdminProtectedRoute>
                      <AdminLayout />
                    </AdminProtectedRoute>
                  }
                >
                  <Route index element={<AdminHomeRedirect />} />
                  <Route
                    path="dashboard"
                    element={
                      <TabGuard tabKey="dashboard">
                        <Dashboard />
                      </TabGuard>
                    }
                  />
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
                        <ScoringMatches />
                      </TabGuard>
                    }
                  />
                  <Route
                    path="live"
                    element={
                      <TabGuard tabKey="live">
                        <LiveNotes />
                      </TabGuard>
                    }
                  />
                </Route>

                {/* Root path redirect */}
                <Route
                  path="/"
                  element={
                    user ? (
                      <Navigate to="/admin" replace />
                    ) : (
                      <Navigate to="/public" replace />
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
