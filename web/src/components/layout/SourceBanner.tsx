// One quiet line at the top of Ask and Dashboards when the warehouse cannot be read with the saved connection
// (AppState.source.error). The shell, the nav and Settings keep working; reads fail with the same sentence.
import { Link } from "react-router";
import { useAppState } from "@/api/queries";
import { StatusGlyph } from "@/components/art/StatusGlyph";
import { useT } from "@/i18n";
import { sourceUnavailableSentence } from "@/lib/errors";
import { cn } from "cn";

export function SourceBanner({ className }: { className?: string }) {
  const t = useT();
  const { data } = useAppState();
  const text = sourceUnavailableSentence(t, data?.source.error);
  if (!text) return null;
  return (
    <div role="status" className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] leading-[18px] text-text", className)}>
      <StatusGlyph tone="bad" size={12} className="mt-[3px] shrink-0" />
      <p className="min-w-0 flex-1">{text}</p>
      <Link to="/settings/sources" className="shrink-0 font-medium text-accent hover:underline">
        {t.err.source_open}
      </Link>
    </div>
  );
}
