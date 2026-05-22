import { lazy, Suspense, useEffect, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/hooks/useTheme";
import { toast } from "@/components/ui/toast";
import { destinationForStatus } from "@/lib/redirects";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Code-split the heavier authenticated views and rare error pages so they
// don't bloat the initial bundle for the marketing landing page.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const PendingApproval = lazy(() => import("@/pages/PendingApproval"));
const Rejected = lazy(() => import("@/pages/Rejected"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function RouteFallback() {
  // Intentionally minimal — we don't want a flash of "loading" between
  // routes. Each lazy bundle is small and resolves quickly.
  return null;
}

function AppShell() {
  // Apply persisted theme + react to system pref changes.
  useTheme();

  const hydrate = useAuth((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route path="/register" element={<Register />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        <Route
          path="/pending"
          element={
            <Protected requireStatus="pending">
              <PendingApproval />
            </Protected>
          }
        />
        <Route
          path="/rejected"
          element={
            <Protected requireStatus="rejected">
              <Rejected />
            </Protected>
          }
        />

        <Route
          path="/dashboard"
          element={
            <Protected requireStatus="approved">
              <ErrorBoundary>
                <Dashboard />
              </ErrorBoundary>
            </Protected>
          }
        />
        <Route
          path="/dashboard/:symbol"
          element={
            <Protected requireStatus="approved">
              <ErrorBoundary>
                <Dashboard />
              </ErrorBoundary>
            </Protected>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

interface ProtectedProps {
  children: ReactNode;
  requireStatus: "approved" | "pending" | "rejected";
}

function Protected({ children, requireStatus }: ProtectedProps) {
  const location = useLocation();
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);

  // Toasts must not fire during render — React 18 may invoke render twice in
  // StrictMode and concurrent features will queue duplicate notifications.
  useEffect(() => {
    if (status === "banned") {
      toast({
        title: "Account banned",
        description: "Reach out on Discord if you think this is a mistake.",
        variant: "destructive",
      });
    }
  }, [status]);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Show nothing during the first /me round-trip to avoid flicker.
  if (!initialized) {
    return null;
  }

  if (status === "banned") {
    return <Navigate to="/login" replace />;
  }

  if (status !== requireStatus) {
    return <Navigate to={destinationForStatus(status)} replace />;
  }

  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);
  if (token && initialized && status) {
    return <Navigate to={destinationForStatus(status)} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
