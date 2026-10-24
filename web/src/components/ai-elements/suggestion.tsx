// Vercel AI Elements `suggestion` (registry.ai-sdk.dev/suggestion.json, added with shadcn@4.21.4), adapted to Tally:
// `cn` from the kit, no "use client", 4 px control radius instead of a pill, and a `wrap` layout for the empty state
// (the registry version only scrolls sideways). `hint` adds a small muted second line inside the chip.
import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

export type SuggestionsProps = ComponentProps<typeof ScrollArea> & { wrap?: boolean };

export const Suggestions = ({ className, children, wrap, ...props }: SuggestionsProps) =>
  wrap ? (
    <div className={cn("flex flex-wrap items-start gap-2", className)}>{children}</div>
  ) : (
    <ScrollArea className="w-full overflow-x-auto whitespace-nowrap" {...props}>
      <div className={cn("flex w-max flex-nowrap items-center gap-2 pb-1", className)}>{children}</div>
      <ScrollBar className="hidden" orientation="horizontal" />
    </ScrollArea>
  );

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  hint?: ReactNode;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({ suggestion, hint, onClick, className, variant = "outline", size = "sm", children, ...props }: SuggestionProps) => (
  <Button
    className={cn("max-w-full cursor-pointer rounded-md text-left whitespace-normal", hint && "h-auto flex-col items-start gap-0 py-1.5", className)}
    onClick={() => onClick?.(suggestion)}
    size={size}
    type="button"
    variant={variant}
    {...props}
  >
    {children || suggestion}
    {hint && <span className="text-2xs font-normal text-text-muted">{hint}</span>}
  </Button>
);
