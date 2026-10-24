// A verdict as glyph + word (Tally `.status`), never colour alone and never a filled chip. Red only for
// "does not add up", the gap.
import { cn } from "cn";
import type { Verdict } from "@/api/types";
import { StatusGlyph } from "@/components/art/StatusGlyph";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";

const TONE: Record<Verdict, { glyph: "ok" | "bad" | "warn"; cls: string }> = {
  adds_up: { glyph: "ok", cls: "text-success" },
  does_not_add_up: { glyph: "bad", cls: "text-danger" },
  insufficient_data: { glyph: "warn", cls: "text-warning" },
  not_checked: { glyph: "warn", cls: "text-warning" },
};

export function Status({ verdict, size = "sm", word, className }: { verdict: Verdict; size?: "sm" | "md" | "lg"; word?: string; className?: string }) {
  const t = useT();
  const { glyph, cls } = TONE[verdict];
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium whitespace-nowrap",
        size === "sm" && "gap-1 font-mono text-2xs",
        size === "md" && "gap-1.5 font-mono text-[13px]",
        size === "lg" && "gap-1.5 text-sm",
        cls,
        className,
      )}
    >
      <StatusGlyph tone={glyph} size={size === "sm" ? 12 : size === "md" ? 14 : 16} />
      {word ?? t.ask.verdict[verdict]}
    </span>
  );
}

/** A test step's status word (ok, failed, skipped, running). */
export function StepStatus({ status }: { status: "ok" | "failed" | "skipped" | "running" | "waiting" }) {
  const t = useT();
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs font-medium text-text-muted">
        <Spinner className="size-3" /> {t.set.bq.running}
      </span>
    );
  if (status === "waiting") return <span className="font-mono text-2xs text-text-subtle">{t.format.dash}</span>;
  if (status === "skipped") return <span className="font-mono text-2xs font-medium text-text-muted">{`${t.format.dash} ${t.set.bq.skipped}`}</span>;
  const ok = status === "ok";
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-2xs font-medium", ok ? "text-success" : "text-danger")}>
      <StatusGlyph tone={ok ? "ok" : "bad"} size={12} />
      {ok ? t.set.bq.ok : t.set.bq.failed}
    </span>
  );
}
