// Ported from Overt (ui/SegmentedControl.tsx): a compact radio group for 2 to 5 options; arrow keys move.
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  /** Accessible name when `label` is visual only. */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Accessible group label (segments are a radiogroup). */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string | number>({ options, value, onChange, label, size = "sm", className }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const cur = options.findIndex((o) => o.value === value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    for (let k = 1; k <= options.length; k++) {
      const i = (cur + step * k + options.length) % options.length;
      if (!options[i]!.disabled) {
        onChange(options[i]!.value);
        refs.current[i]?.focus();
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("inline-flex shrink-0 items-center rounded-md border border-border bg-surface-2 p-0.5", className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-sm font-medium transition-colors duration-160 disabled:opacity-50",
              size === "sm" ? "h-6 min-w-7 px-2 text-xs" : "h-7 min-w-8 px-2.5 text-sm",
              active ? "bg-surface text-text-strong ring-1 ring-border-strong ring-inset" : "text-text-muted hover:text-text",
            )}
          >
            {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
