// Ported from Overt (ui/Layout.tsx, ui/Card.tsx): Page and the plain Overt card parts (Panel, PanelHeader).
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "cn";

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
