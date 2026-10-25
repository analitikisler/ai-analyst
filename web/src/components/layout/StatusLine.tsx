// The quiet status line (DECISIONS.md §1): "Demo data · Built-in planner", each half a link to its Settings
// section. Status, not choice; no colour, no dot.
import { Link } from "react-router";
import { cn } from "cn";
import { useAppState } from "@/api/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, useT } from "@/i18n";

export function StatusLine({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const t = useT();
  const { data } = useAppState();
  if (!data) return <Skeleton className={cn("h-4 w-40", className)} />;
  const source = data.source.kind === "demo" ? t.shell.status.demo : data.source.kind === "local" ? t.shell.status.local : fmt(t.shell.status.bigquery, { project: data.source.project ?? "" });
  const model = data.agent.mode === "planner" ? t.shell.status.planner : fmt(t.shell.status.model, { provider: data.agent.provider_label ?? "" });
  const link = "rounded-sm hover:text-text hover:underline";
  return (
    <p className={cn("min-w-0 truncate text-2xs text-text-muted", className)} title={`${source} · ${model}`}>
      <Link to="/settings/sources" onClick={onNavigate} className={link} aria-label={`${t.shell.status.open_data}: ${source}`}>
        {source}
      </Link>
      {" · "}
      <Link to="/settings/model" onClick={onNavigate} className={link} aria-label={`${t.shell.status.open_model}: ${model}`}>
        {model}
      </Link>
    </p>
  );
}
