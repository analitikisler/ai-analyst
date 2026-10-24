// A folded row (08-art.md §4 #20) on native <details>: 36 px, chevron that turns 90°, label and a mono summary.
import type { ReactNode } from "react";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";

export interface DisclosureProps {
  label: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  onToggle?: (open: boolean) => void;
}

export function Disclosure({ label, meta, children, defaultOpen, className, bodyClassName, onToggle }: DisclosureProps) {
  return (
    <details className={cn("group/disc", className)} open={defaultOpen} onToggle={(e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex min-h-9 cursor-pointer list-none items-start gap-2 rounded-sm py-2 text-[13px] leading-[18px] outline-offset-[-2px] select-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-text-subtle transition-transform duration-160 group-open/disc:rotate-90" />
        <span className="shrink-0 font-medium text-text">{label}</span>
        {meta && <span className="min-w-0 font-mono text-text-muted">{meta}</span>}
      </summary>
      <div className={cn("pt-1 pb-3 pl-6", bodyClassName)}>{children}</div>
    </details>
  );
}
