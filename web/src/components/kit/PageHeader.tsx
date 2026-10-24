// Ported from Overt (ui/PageHeader.tsx): H1 in the display face 28/34 at 570 (24/32 on phones), muted
// subtitle, a title addon, actions on the right (one primary at most), optional breadcrumbs. Sets document.title.
import { Fragment, useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { fmt, useT } from "@/i18n";

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Inline after the title (the "Example" badge on a dashboard). */
  titleAddon?: ReactNode;
  /** `document.title`; defaults to "{title} · AI Analyst" when `title` is a string. `false` leaves it. */
  documentTitle?: string | false;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, breadcrumbs, titleAddon, documentTitle, className }: PageHeaderProps) {
  const t = useT();
  const docTitle = documentTitle === false ? null : (documentTitle ?? (typeof title === "string" ? fmt(t.app.pageTitle, { page: title }) : null));
  useEffect(() => {
    if (docTitle) document.title = docTitle;
  }, [docTitle]);
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label={t.shell.breadcrumb} className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-text-subtle">
              {breadcrumbs.map((c, i) => (
                <Fragment key={i}>
                  <li>
                    {c.to ? (
                      <Link to={c.to} className="hover:text-text">
                        {c.label}
                      </Link>
                    ) : (
                      <span aria-current="page">{c.label}</span>
                    )}
                  </li>
                  {i < breadcrumbs.length - 1 && (
                    <li aria-hidden>
                      <ChevronRightIcon size={12} strokeWidth={1.75} />
                    </li>
                  )}
                </Fragment>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl leading-8 font-heading tracking-[-0.012em] text-text-strong sm:text-[28px] sm:leading-[34px]">{title}</h1>
          {titleAddon}
        </div>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
