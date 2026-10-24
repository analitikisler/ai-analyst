// The sidebar model (owner rounds 4 and 5): Ask, Dashboards and Metrics; Settings sits in the footer. Checks live on each
// dashboard (the check strip) and Activity is a Settings section.
// Icons per 08-art.md §7.1.
import { BookOpenTextIcon, LayoutDashboardIcon, MessageSquareTextIcon, Settings2Icon, type LucideIcon } from "lucide-react";

export type NavKey = "ask" | "dashboards" | "metrics" | "settings";

export interface NavItem {
  key: NavKey;
  icon: LucideIcon;
  to: string;
}

export const MAIN_NAV: NavItem[] = [
  { key: "ask", icon: MessageSquareTextIcon, to: "/ask" },
  { key: "dashboards", icon: LayoutDashboardIcon, to: "/dashboards" },
  { key: "metrics", icon: BookOpenTextIcon, to: "/metrics" },
];

export const SETTINGS_NAV: NavItem = { key: "settings", icon: Settings2Icon, to: "/settings" };
