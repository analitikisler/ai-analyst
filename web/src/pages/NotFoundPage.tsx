// Not found (09-ux.md S14): the house tally (pages expected 1, found 0), what happened, the way out. The in-place
// variants keep the shell for an unknown conversation, dashboard or check.
import { useEffect } from "react";
import { Link } from "react-router";
import { usePhoneTitle } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { fmt, useT } from "@/i18n";

function MicroTally() {
  const t = useT();
  return (
    <div className="mb-2 grid grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1.5 text-2xs text-text-muted" aria-label={`${t.nf.tally_expected} 1 · ${t.nf.tally_found} 0`} role="img">
      <span aria-hidden>{t.nf.tally_expected}</span>
      <span aria-hidden className="size-6 rounded-xs border border-chart-ref-edge bg-surface" />
      <span aria-hidden className="font-mono text-text">1</span>
      <span aria-hidden>{t.nf.tally_found}</span>
      <span aria-hidden className="size-6 rounded-xs border border-dashed border-danger" />
      <span aria-hidden className="font-mono text-text">0</span>
    </div>
  );
}

export function NotFoundInline({ title, action, to }: { title: string; action: string; to: string }) {
  const t = useT();
  usePhoneTitle(t.nf.title);
  useEffect(() => {
    document.title = fmt(t.app.pageTitle, { page: t.nf.title });
  }, [t]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <MicroTally />
      <div className="max-w-md">
        <h1 className="font-display text-2xl leading-8 font-heading text-text-strong">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">{t.nf.body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button render={<Link to={to} />} nativeButton={false}>
          {action}
        </Button>
        <Button variant="outline" render={<Link to="/ask" />} nativeButton={false}>
          {t.nf.go_ask}
        </Button>
      </div>
    </div>
  );
}

export default function NotFoundPage() {
  const t = useT();
  usePhoneTitle(t.nf.title);
  useEffect(() => {
    document.title = fmt(t.app.pageTitle, { page: t.nf.title });
  }, [t]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <MicroTally />
      <div className="max-w-md">
        <h1 className="font-display text-2xl leading-8 font-heading text-text-strong">{t.nf.title}</h1>
        <p className="mt-2 text-sm text-text-muted">{t.nf.body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button render={<Link to="/ask" />} nativeButton={false}>
          {t.nf.go_ask}
        </Button>
        <Button variant="outline" render={<Link to="/dashboards" />} nativeButton={false}>
          {t.nf.open_dashboards}
        </Button>
      </div>
    </div>
  );
}
