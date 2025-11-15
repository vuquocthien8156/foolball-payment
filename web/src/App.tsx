import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { PWAInstallProvider } from "./contexts/PWAInstallContext";

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

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const PublicRoute = ({ children }: { children: JSX.Element }) => {
  const { user } = useAuth();
  if (user) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return children;
};

const App = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <PWAInstallProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense
              fallback={
                <div className="fixed inset-0 flex items-center justify-center bg-background">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                </div>
              }
            >
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
                    <ProtectedRoute>
                      <AdminLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route
                    index
                    element={<Navigate to="/admin/dashboard" replace />}
                  />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="setup" element={<SetupMatch />} />
                  <Route path="setup/:matchId" element={<SetupMatch />} />
                  <Route path="members" element={<Members />} />
                  <Route path="matches" element={<Matches />} />
                </Route>

                {/* Root path redirect */}
                <Route
                  path="/"
                  element={
                    user ? (
                      <Navigate to="/admin/dashboard" replace />
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
