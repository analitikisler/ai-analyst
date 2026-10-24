// The answer mark: one 3 px orange bar under the one figure a section exists to show (Tally `mark`). It is drawn
// left to right once (220 ms) when `draw` is set; nothing moves under reduced motion.
import type { ReactNode } from "react";
import { cn } from "cn";

export function Marked({ children, draw, className, label }: { children: ReactNode; draw?: boolean; className?: string; label?: string }) {
  return (
    <span className={cn("relative inline-block", className)} aria-label={label} role={label ? "text" : undefined}>
      <span aria-hidden={label ? true : undefined}>{children}</span>
      <span aria-hidden className={cn("absolute inset-x-0 -bottom-[7px] h-[3px] origin-left bg-mark", draw && "animate-[aia-draw_220ms_var(--ease-out)_560ms_both]")} />
    </span>
  );
}

/** "Δ −10.1%": Δ in the sans face (Code and Flex have no Δ), the figure in mono. */
export function DeltaFigure({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("font-mono font-medium tracking-[-0.04em] tnum", className)}>
      <span className="font-sans font-normal tracking-normal" aria-hidden>
        Δ{" "}
      </span>
      {value}
    </span>
  );
}
