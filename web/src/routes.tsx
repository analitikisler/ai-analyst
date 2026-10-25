// Routes (09-ux.md §1.2; DECISIONS.md §2). The router itself is in router.tsx.
import { Navigate, useLocation, useParams, useRouteError, type RouteObject } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorState } from "@/components/kit";

/** Every page is its own chunk. */
/** A redirect that keeps the query (?connect=bigquery) and the hash. */
function RedirectKeepingSearch({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

function RouteError() {
  const error = useRouteError();
  return <ErrorState error={error} onRetry={() => window.location.reload()} />;
}

/** /checks/:id (and ?run=) opens the default dashboard with that check's sheet. */
export function CheckRedirect() {
  const { checkId } = useParams();
  const { search } = useLocation();
  const next = new URLSearchParams(search);
  next.set("check", checkId ?? "");
  return <Navigate to={`/dashboards?${next.toString()}`} replace />;
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    HydrateFallback: () => null,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate to="/ask" replace /> },
          { path: "ask", lazy: page(() => import("@/pages/AskPage")) },
          { path: "ask/:conversationId", lazy: page(() => import("@/pages/AskPage")) },
          { path: "dashboards", lazy: async () => ({ Component: (await import("@/pages/DashboardPage")).DashboardsIndex }) },
          { path: "dashboards/:dashboardId", lazy: page(() => import("@/pages/DashboardPage")) },
          { path: "metrics", lazy: page(() => import("@/pages/MetricsPage")) },
          { path: "metrics/:metricId", lazy: page(() => import("@/pages/MetricsPage")) },
          // Checks live on the dashboard and Activity in Settings (owner round 4); old links still land.
          { path: "checks", element: <Navigate to="/dashboards" replace /> },
          { path: "checks/:checkId", element: <CheckRedirect /> },
          { path: "activity", element: <Navigate to="/settings/activity" replace /> },
          { path: "settings", element: <Navigate to="/settings/sources" replace /> },
          // Data source became Sources (connectors round); old links keep working, ?connect= included.
          { path: "settings/data", element: <RedirectKeepingSearch to="/settings/sources" /> },
          { path: "settings/chat-apps", element: <Navigate to="/settings/chat-apps/claude-desktop" replace /> },
          { path: "settings/chat-apps/:client", lazy: page(() => import("@/pages/SettingsPage")) },
          { path: "settings/:section", lazy: page(() => import("@/pages/SettingsPage")) },
          // The reviewer index exists only in the demo build (VITE_API=fixtures).
          ...(__DEMO__ ? [{ path: "tour", lazy: page(() => import("@/pages/TourPage")) }] : []),
          { path: "*", lazy: page(() => import("@/pages/NotFoundPage")) },
        ],
      },
    ],
  },
];
