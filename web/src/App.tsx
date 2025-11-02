import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import Members from "./pages/Members";
import SetupMatch from "./pages/SetupMatch";
import Pay from "./pages/Pay";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentCancel from "./pages/PaymentCancel";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Attendance from "./pages/Attendance";
import PublicPortal from "./pages/PublicPortal";

import { useAuth } from "./contexts/AuthContext";
import { PWAInstallProvider } from "./contexts/PWAInstallContext";

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
    // You can return a global loading spinner here if you want
    return null;
  }

  return (
    <PWAInstallProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </PWAInstallProvider>
  );
};

export default App;
