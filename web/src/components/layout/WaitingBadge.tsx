// What waits for a decision (owner round 4): a small badge button in the top bar, only while something waits. It opens
// a popover with each waiting item (Approve, Decline) and a link to the full list in Settings › Activity. Approvals
// still also appear inline in the conversation.
import { Link } from "react-router";
import { useAppState } from "@/api/queries";
import { ApprovalCard } from "@/components/ask/Thread";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { plural, useLang, useT } from "@/i18n";

export function WaitingBadge() {
  const t = useT();
  const lang = useLang();
  const { data } = useAppState();
  const pending = data?.proposals.filter((p) => p.status === "pending") ?? [];
  if (!pending.length) return null;
  const label = plural(lang, pending.length, t.shell.waiting.button, { n: pending.length });
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="border-accent/40 bg-accent-soft text-accent-ink hover:bg-accent-soft" />}>
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={{ top: 64, bottom: 8, left: 8, right: 8 }} className="max-h-[var(--available-height)] w-[22rem] max-w-[calc(100vw-16px)] gap-3 overflow-y-auto p-3">
        <p className="text-sm font-semibold text-text-strong">{t.shell.waiting.title}</p>
        {pending.map((p) => (
          <ApprovalCard key={p.id} proposal={p} where="activity" />
        ))}
        <Link to="/settings/activity?filter=waiting" className="text-[13px] font-medium text-accent hover:underline">
          {t.shell.waiting.open_all}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
