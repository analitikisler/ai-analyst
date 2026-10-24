// Ported from Overt (ui/Tooltip.tsx InfoTip) onto the shadcn Tooltip (Base UI).
import type { ReactNode } from "react";
import { cn } from "cn";
import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmt, useT } from "@/i18n";

export interface GlossaryTerm {
  term: string;
  short: string;
  long?: string;
}

export interface InfoTipProps {
  /** A glossary entry, or free content. */
  term?: GlossaryTerm;
  content?: ReactNode;
  /** Accessible name; defaults to "About {term}". */
  label?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/** A 16 px info button that explains a term on hover or focus. Define a term once, in the copy. */
export function InfoTip({ term, content, label, side = "top", className }: InfoTipProps) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label ?? (term ? fmt(t.kit.about, { term: term.term }) : t.kit.aboutThis)}
        className={cn("inline-flex size-4 items-center justify-center rounded-sm text-text-subtle transition-colors hover:text-text", className)}
      >
        <InfoIcon size={14} strokeWidth={1.75} aria-hidden />
      </TooltipTrigger>
      <TooltipContent side={side}>
        <span className="block">
          {term && <span className="mb-0.5 block font-semibold text-text-strong">{term.term}</span>}
          <span className="block text-text-muted">{term ? (term.long ?? term.short) : content}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
