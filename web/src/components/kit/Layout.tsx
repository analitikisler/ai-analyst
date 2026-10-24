// Ported from Overt (ui/Layout.tsx, ui/Card.tsx): Page, Section, StatGrid, and the plain Overt card parts
// (the shadcn Card composition is in components/ui/card.tsx; these are the denser Overt variants).
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "cn";

const colsBase = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as const;
const colsSm = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" } as const;
const colsMd = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" } as const;
const colsLg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" } as const;
const colsXl = { 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" } as const;

export interface StatGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Columns per breakpoint (static class map, so only the listed values exist). */
  cols?: { base?: keyof typeof colsBase; sm?: keyof typeof colsSm; md?: keyof typeof colsMd; lg?: keyof typeof colsLg; xl?: keyof typeof colsXl };
}

/** Responsive grid for figure tiles and card rows, 16 px gaps. Default 2 → 3 (md) → 6 (xl). */
export function StatGrid({ cols = { base: 2, md: 3, xl: 6 }, className, ...rest }: StatGridProps) {
  return (
    <div
      className={cn("grid gap-4", colsBase[cols.base ?? 1], cols.sm && colsSm[cols.sm], cols.md && colsMd[cols.md], cols.lg && colsLg[cols.lg], cols.xl && colsXl[cols.xl], className)}
      {...rest}
    />
  );
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/** Page section with an H2 row. */
export function Section({ title, description, actions, className, children, ...rest }: SectionProps) {
  return (
    <section className={cn("min-w-0", className)} {...rest}>
      {(title || actions) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="font-sans text-base font-semibold text-text-strong">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Page content: max width 1440, 24 px between sections. */
export function Page({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto flex w-full max-w-[1440px] flex-col gap-6", className)} {...rest} />;
}

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Standard 16 px padding. */
  padded?: boolean;
  /** Hover affordance for clickable panels. */
  interactive?: boolean;
}

/** Surface panel: 1 px rule, 6 px radius, no shadow. */
export function Panel({ padded, interactive, className, ...rest }: PanelProps) {
  return (
    <div
      data-print="avoid-break"
      className={cn("min-w-0 rounded-lg border border-border bg-surface", padded && "p-4", interactive && "transition-[border-color] duration-160 ease-out hover:border-border-strong", className)}
      {...rest}
    />
  );
}

export interface PanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  titleAddon?: ReactNode;
}

/** Panel title row: H3 (16/600), muted subtitle, actions that wrap below on narrow panels. */
export function PanelHeader({ title, subtitle, actions, titleAddon, className, ...rest }: PanelHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4", className)} {...rest}>
      <div className="min-w-0 flex-[1_1_12rem]">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate font-sans text-base font-semibold text-text-strong">{title}</h3>
          {titleAddon}
        </div>
        {subtitle && <p className="mt-0.5 text-[13px] leading-[18px] text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
