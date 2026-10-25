// Ported from Overt (ui/ModeBadge.tsx), 08-art.md §4 #14: the data source and the model route as neutral 20 px
// badges (no "Live" dot: there is no simulated mode to contrast with). Shown once, in an answer's foot.
import { cn } from "cn";
import { DatabaseIcon, FlaskConicalIcon, KeyRoundIcon, WorkflowIcon } from "lucide-react";
import type { AgentMode, AppState } from "@/api/types";
import { fmt, useT } from "@/i18n";

const chip = "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 text-2xs font-medium whitespace-nowrap text-text-muted";

export function DataSourceBadge({ source, className }: { source: AppState["source"]; className?: string }) {
  const t = useT();
  const Icon = source.kind === "demo" ? FlaskConicalIcon : DatabaseIcon;
  return (
    <span className={cn(chip, className)}>
      <Icon size={12} strokeWidth={1.75} aria-hidden />
      {source.kind === "demo" ? t.shell.status.demo : source.kind === "local" ? t.shell.status.local : fmt(t.shell.status.bigquery, { project: source.project ?? "" })}
    </span>
  );
}

export function ModelBadge({ agent, className }: { agent: AgentMode; className?: string }) {
  const t = useT();
  const Icon = agent.mode === "planner" ? WorkflowIcon : KeyRoundIcon;
  return (
    <span className={cn(chip, className)}>
      <Icon size={12} strokeWidth={1.75} aria-hidden />
      {agent.mode === "planner" ? t.shell.status.planner : (agent.model_label ?? agent.provider_label)}
    </span>
  );
}
