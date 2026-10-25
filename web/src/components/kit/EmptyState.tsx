// Ported from Overt (ui/EmptyState.tsx): what is missing, why it matters, one action.
import type { ReactNode } from "react";
import { cn } from "cn";
import { RotateCcwIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { isApiError } from "@/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { sourceUnavailableSentence } from "@/lib/errors";

export interface EmptyStateProps {
  title: ReactNode;
  /** What is missing and why it matters (one or two sentences). */
  body?: ReactNode;
  /** Lucide icon on a 48 px surface-2 tile (ignored when `illustration` is set). */
  icon?: LucideIcon;
  /** Art slot (a theme-aware SVG component). */
  illustration?: ReactNode;
  /** The one action that fixes it, plus an optional secondary. */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Dashed card around it, for empty sections inside a page. */
  bordered?: boolean;
  className?: string;
}

export function EmptyState({ title, body, icon: Icon, illustration, action, secondaryAction, size = "md", bordered, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 px-4 py-6" : size === "md" ? "gap-3 px-6 py-10" : "gap-4 px-6 py-16",
        bordered && "rounded-lg border border-dashed border-border-strong bg-surface",
        className,
      )}
    >
      {illustration ? (
        <div className="mb-1 flex justify-center">{illustration}</div>
      ) : Icon ? (
        <div className="flex size-12 items-center justify-center rounded-lg bg-surface-2 text-text-muted">
          <Icon size={24} strokeWidth={1.75} aria-hidden />
        </div>
      ) : null}
      <div className="max-w-md">
        <h3 className={cn("font-semibold text-text-strong", size === "lg" ? "text-xl" : "text-base")}>{title}</h3>
        {body && <p className={cn("mt-1 text-text-muted", size === "sm" ? "text-[13px]" : "text-sm")}>{body}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  /** Plain-words headline; defaults to the copy's "This did not load". */
  title?: ReactNode;
  /** The thrown error (its message becomes the detail line) or custom detail text. */
  error?: unknown;
  detail?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  size?: "sm" | "md";
  bordered?: boolean;
  className?: string;
}

/** What happened in plain words, the server's message as a detail line, and the way out. */
export function ErrorState({ title, error, detail, onRetry, retrying, size = "md", bordered, className }: ErrorStateProps) {
  const t = useT();
  const message =
    detail ??
    (isApiError(error) && error.code === "source_unavailable"
      ? sourceUnavailableSentence(t, error)!
      : isApiError(error) && error.code === "not_in_fixtures" ? t.err.invalid_input : error instanceof TypeError ? t.err.network.body : error instanceof Error ? error.message : t.err.generic);
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 text-center", size === "sm" ? "px-4 py-6" : "px-6 py-10", bordered && "rounded-lg border border-border bg-surface", className)}>
      <div className="flex size-10 items-center justify-center rounded-lg bg-warning-soft text-warning">
        <TriangleAlertIcon size={20} strokeWidth={1.75} aria-hidden />
      </div>
      <div className="max-w-md">
        <h3 className="text-base font-semibold text-text-strong">{title ?? t.err.generic}</h3>
        <p className="mt-1 text-sm text-text-muted">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon strokeWidth={1.75} data-icon="inline-start" />}
          {t.common.try_again}
        </Button>
      )}
    </div>
  );
}
