import { Navigate, type RouteObject, useRoutes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { RootLayout } from "@/app/RootLayout";

const LoginPage = lazy(() => import("@/pages/Login"));
const DashboardPage = lazy(() => import("@/pages/Dashboard"));
const NotFoundPage = lazy(() => import("@/pages/NotFound"));

/**
 * Route table. Three.js is intentionally NOT pulled into the entry
 * bundle — it lives behind /dashboard which is lazy-loaded. The login
 * page must reach interactive state on a 200KB initial JS budget.
 */
const routes: RouteObject[] = [
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        path: "dashboard",
        element: (
          <Suspense fallback={<div className="p-6">loading</div>}>
            <DashboardPage />
          </Suspense>
        ),
      },
      {
        path: "dashboard/:symbol",
        element: (
          <Suspense fallback={<div className="p-6">loading</div>}>
            <DashboardPage />
          </Suspense>
        ),
      },
    ],
  },
  {
    path: "/login",
    element: (
      <Suspense fallback={<div className="p-6">loading</div>}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    path: "*",
    element: (
      <Suspense fallback={null}>
        <NotFoundPage />
      </Suspense>
    ),
  },
];

export function AppRoutes() {
  return useRoutes(routes);
}
