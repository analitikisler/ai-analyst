// App shell (Overt AppLayout; 08-art.md §2.2, 09-ux.md S01): the 232 px sidebar from 1024 px, a 56 px top bar
// with the page's own controls on the left and Ask (⌘K) and the theme menu on the right; below 1024 px a 48 px top
// bar with the menu button, the page title and Ask, and Overt's drawer (DECISIONS.md §9: no bottom tab bar, the
// composer owns the bottom edge). The Ask sheet, the metric sheet and the review menu live here too.
import { useEffect, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router";
import { MenuIcon, MessageSquareTextIcon } from "lucide-react";
import { useAppState } from "@/api/queries";
import { ErrorState } from "@/components/kit";
import { isApiError } from "@/api";
import { describeError } from "@/lib/errors";
import { SourceBanner } from "./SourceBanner";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { fmt, useT } from "@/i18n";
import { AskSheet } from "./AskSheet";
import { AuditSheet } from "@/components/checks/AuditSheet";
import { ReviewMenu } from "./ReviewMenu";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { WaitingBadge } from "./WaitingBadge";
import { TopBarSlotProvider, useSlotNodes } from "./TopBar";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The page an Ask sheet opened with ⌘K is about. */
function aboutFor(pathname: string, params: URLSearchParams): string | null {
  const check = params.get("check");
  if (check) return `check:${check}`;
  const dash = /^\/dashboards\/([^/]+)/.exec(pathname);
  if (dash) return `dashboard:${dash[1]}`;
  return null;
}

export function AppShell() {
  const t = useT();
  const f = useFormat();
  const [navOpen, setNavOpen] = useState(false);
  const [title, setTitle] = useState("");
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const slots = useSlotNodes();
  const { isError, error: stateError, refetch, isFetching } = useAppState();
  // Which kind of failure: not running (network), the access token (401), or a server error.
  const failure = !isError
    ? null
    : isApiError(stateError) && stateError.status === 401
      ? t.err.unauthorized
      : isApiError(stateError) && stateError.code !== "network" && (stateError.status >= 500 || stateError.code === "http_error")
        ? { title: t.err.server.title, body: `${t.err.server.body} ${fmt(t.err.details, { code: `${stateError.code} ${stateError.status || ""}`.trim() })}` }
        : t.err.network;
  // An action nobody handled (a click that failed on the server, or the server going away) says so in a toast.
  useEffect(() => {
    const onReject = (e: PromiseRejectionEvent) => {
      if (!isApiError(e.reason)) return;
      e.preventDefault();
      notify(describeError(t, e.reason, f.bytes), { type: "error" });
    };
    window.addEventListener("unhandledrejection", onReject);
    return () => window.removeEventListener("unhandledrejection", onReject);
  }, [t, f]);
  const onAsk = location.pathname.startsWith("/ask");

  useEffect(() => setNavOpen(false), [location.pathname]);
  // A route change moves focus to the page heading (09-ux.md §5.2), except for the first load.
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>("main h1");
    if (h1 && document.activeElement && document.activeElement !== document.body) {
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
    if (!location.hash) window.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);

  const openAsk = () => {
    if (onAsk) {
      document.querySelector<HTMLTextAreaElement>("main textarea")?.focus();
      return;
    }
    const next = new URLSearchParams(params);
    const about = aboutFor(location.pathname, params);
    next.delete("check");
    next.delete("run");
    next.set("ask", "new");
    if (about) next.set("about", about);
    setParams(next);
  };

  // ⌘K / Ctrl+K anywhere; "/" when not typing (09-ux.md §5.1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openAsk();
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openAsk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const askButton = !onAsk && (
    <Button variant="outline" size="sm" onClick={openAsk} aria-keyshortcuts="Meta+K Control+K" title={t.shell.ask_shortcut}>
      <MessageSquareTextIcon strokeWidth={1.75} data-icon="inline-start" />
      {t.shell.ask}
      <Kbd className="ml-1 pointer-coarse:hidden">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
    </Button>
  );

  return (
    <TopBarSlotProvider desktop={slots.desktop} phoneRow={slots.phoneRow} phoneActions={slots.phoneActions} setTitle={setTitle}>
      <div className="min-h-dvh bg-bg">
        <a
          href="#main"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main")?.focus();
          }}
          className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium text-text shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          {t.shell.skip}
        </a>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" showCloseButton={false} className="w-[264px] gap-0 bg-surface p-0 data-[side=left]:w-[264px]">
            <SheetTitle className="sr-only">{t.shell.nav.label}</SheetTitle>
            <Sidebar onNavigate={() => setNavOpen(false)} footer={<ThemeToggle align="start" />} />
          </SheetContent>
        </Sheet>

        <div className="lg:flex">
          <aside data-print="hide" className="hidden w-[232px] shrink-0 border-r border-border bg-surface lg:block">
            <div className="sticky top-0 h-dvh">
              <Sidebar />
            </div>
          </aside>

          <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
            <header data-print="hide" className="sticky top-0 z-30 border-b border-border bg-bg">
              <div className="hidden h-14 items-center gap-3 px-6 lg:flex">
                <div ref={slots.setDesktop} className="flex min-w-0 flex-1 items-center gap-2" />
                <div className="flex shrink-0 items-center gap-1.5">
                  <WaitingBadge />
                  {askButton}
                  <ThemeToggle />
                </div>
              </div>
              <div className="flex h-12 items-center gap-1 px-2 lg:hidden">
                <Button variant="ghost" size="icon" className="size-10" aria-label={t.shell.menu_open} aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
                  <MenuIcon strokeWidth={1.75} />
                </Button>
                <p className="min-w-0 flex-1 truncate text-base leading-6 font-semibold text-text-strong">{title}</p>
                <div ref={slots.setPhoneActions} className="flex items-center empty:hidden" />
                <WaitingBadge />
                {!onAsk && (
                  <Button variant="ghost" size="icon" className="size-10" aria-label={t.shell.ask} onClick={openAsk}>
                    <MessageSquareTextIcon strokeWidth={1.75} />
                  </Button>
                )}
                <ThemeToggle />
              </div>
              <div ref={slots.setPhoneRow} className="empty:hidden lg:hidden" />
            </header>
            <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col px-4 py-4 outline-none md:px-6 md:py-6 xl:py-8">
              {failure ? (
                <ErrorState title={failure.title} detail={failure.body} onRetry={() => void refetch()} retrying={isFetching} />
              ) : (
                <>
                  {(onAsk || location.pathname.startsWith("/dashboards")) && <SourceBanner className="mb-4" />}
                  <Outlet />
                </>
              )}
            </main>
          </div>
        </div>
        <AskSheet />
        <AuditSheet />
        {__DEMO__ && <ReviewMenu />}
      </div>
    </TopBarSlotProvider>
  );
}
