// Left navigation (Overt Sidebar; 08-art.md §2.2, 09-ux.md S01): 232 px; the same component in the phone drawer.
// Logo row 56 (the mono Analitik İşler logo, a divider, "ai analyst"), the workspace row, four items, the
// Make it yours card, then Settings and the status line.
import { Link, NavLink, useLocation } from "react-router";
import { cn } from "cn";
import { FlaskConicalIcon } from "lucide-react";
import { useAppState } from "@/api/queries";
import { useAskStore } from "@/ask/AskStore";
import { AiAnalystLogo } from "@/components/art/BrandLogos";
import { StatusGlyph } from "@/components/art/StatusGlyph";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, useT } from "@/i18n";
import { MakeItYoursCard } from "./MakeItYoursCard";
import { MAIN_NAV, SETTINGS_NAV, type NavItem } from "./nav";
import { StatusLine } from "./StatusLine";

const itemCls = (active: boolean) =>
  cn(
    "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium outline-offset-[-2px] transition-colors duration-160 pointer-coarse:h-11",
    active ? "bg-primary-soft text-accent-ink" : "text-text-muted hover:bg-surface-2 hover:text-text",
  );

export function Lockup({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  return (
    // The ai analyst lockup (BRAND §6) in the text colour, red point only; 20 px tall keeps the x-height above 9 px,
    // and the padding gives it its clear space (2 stems).
    <Link to="/ask" onClick={onNavigate} aria-label={t.shell.home} className="flex w-fit items-center rounded-sm p-1.5 text-text-strong">
      <AiAnalystLogo height={20} decorative />
    </Link>
  );
}

function WorkspaceRow({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const { data } = useAppState();
  if (!data) return <Skeleton className="h-12 w-full" />;
  return (
    <Link to="/settings/sources" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-2 py-1.5 transition-colors hover:bg-surface-2">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft font-display text-sm font-semibold text-accent-ink">
        {data.workspace.name.slice(0, 1).toLocaleUpperCase("tr")}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">{data.workspace.name}</span>
      {data.workspace.demo && (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 text-2xs font-medium text-text-muted">
          <FlaskConicalIcon size={12} strokeWidth={1.75} aria-hidden />
          {t.shell.demo_badge}
        </span>
      )}
    </Link>
  );
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const t = useT();
  const { pathname } = useLocation();
  const { data } = useAppState();
  const { running } = useAskStore();
  const Icon = item.icon;
  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
  const changed = item.key === "dashboards" ? (data?.badges.checks_changed ?? 0) : 0;
  const waiting = 0; // Waiting decisions show in the top bar (WaitingBadge).
  return (
    <NavLink to={item.to} onClick={onNavigate} className={itemCls(active)} aria-current={active ? "page" : undefined}>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      <span className="truncate">{t.shell.nav[item.key]}</span>
      {item.key === "ask" && running && (
        <>
          <span aria-hidden className="ml-auto size-1.5 bg-accent" />
          <span className="sr-only">{t.shell.working}</span>
        </>
      )}
      {changed > 0 && (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-2xs text-text">
          {changed}
          <span className="sr-only">{fmt(t.shell.badge.checks, { n: changed })}</span>
        </span>
      )}
      {waiting > 0 && (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-accent/40 bg-accent-soft px-1 font-mono text-2xs text-accent-ink">
          {waiting}
          <span className="sr-only">{fmt(t.shell.badge.waiting, { n: waiting })}</span>
        </span>
      )}
    </NavLink>
  );
}

export function Sidebar({ onNavigate, footer }: { onNavigate?: () => void; footer?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Lockup onNavigate={onNavigate} />
      </div>
      <div className="px-3 pb-3">
        <WorkspaceRow onNavigate={onNavigate} />
      </div>
      <nav aria-label={t.shell.nav.label} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <ul className="mt-1 flex flex-col gap-px">
          {MAIN_NAV.map((item) => (
            <li key={item.key}>
              <NavRow item={item} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex shrink-0 flex-col gap-3 px-3 pb-3">
        <MakeItYoursCard onNavigate={onNavigate} />
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <NavRow item={SETTINGS_NAV} onNavigate={onNavigate} />
          <div className="flex items-center justify-between gap-2 px-2">
            <StatusLine onNavigate={onNavigate} className="min-w-0 flex-1" />
            {footer}
          </div>
          {/* Its own line, so the status line keeps the full sidebar width in both languages. */}
          <div className="px-2">
            <span title={t.app.alpha_hint} className="inline-flex rounded-sm border border-border px-1 font-mono text-2xs leading-4 text-text-muted">{t.app.alpha}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { StatusGlyph };
