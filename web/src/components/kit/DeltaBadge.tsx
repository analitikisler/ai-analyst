// Ported from Overt (ui/DeltaBadge.tsx). One change from Overt: a metric's change is data, not a verdict, so
// it is neutral (house rule: red is only for gaps). `gap` is for a check outside tolerance: red, with the
// glyph and the word from VerdictBadge next to it.
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { cn } from "cn";
import type { Unit } from "@/api/types";
import { useFormat } from "@/lib/format";

export interface DeltaBadgeProps {
  current: number | null | undefined;
  previous: number | null | undefined;
  unit: Unit;
  /** `data` (default, neutral) or `gap` (a check outside tolerance). */
  tone?: "data" | "gap";
  /** `soft` chip (default) or `plain` text. */
  variant?: "soft" | "plain";
  size?: "sm" | "md";
  className?: string;
}

const tones = {
  data: { soft: "border border-border bg-surface-2 text-text", plain: "text-text" },
  gap: { soft: "border border-danger/40 bg-danger-soft text-danger", plain: "text-danger" },
} as const;

/** Signed change with an arrow; the sentence ("up 4.2%") is read to screen readers. Missing → "–". */
export function DeltaBadge({ current, previous, unit, tone = "data", variant = "soft", size = "sm", className }: DeltaBadgeProps) {
  const f = useFormat();
  const d = f.delta(current, previous, unit);
  const Icon = d.direction === "up" ? ArrowUpRightIcon : d.direction === "down" ? ArrowDownRightIcon : MinusIcon;
  return (
    <span
      title={d.direction === "none" ? d.sentence : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm font-mono font-medium whitespace-nowrap tnum",
        variant === "soft" && (size === "sm" ? "h-5 px-1 text-2xs" : "h-6 px-1.5 text-xs"),
        variant === "plain" && (size === "sm" ? "text-xs" : "text-[13px]"),
        tones[tone][variant],
        className,
      )}
    >
      {d.direction !== "none" && <Icon size={size === "sm" ? 12 : 14} strokeWidth={2} aria-hidden />}
      <span aria-hidden>{d.text}</span>
      <span className="sr-only">{d.sentence}</span>
    </span>
  );
}
