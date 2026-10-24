// The reviewer menu (Shift and ?): clearly not part of the product. Lists the twelve flows with a link that starts
// each, a few more states, two simulations of outside systems, and "Reset prototype".
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { loadMock } from "@/api/fixtures";
import { useAppState } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang, useT } from "@/i18n";
import { notify } from "@/lib/notify";
import { flowLinks, stateLinks } from "./review";

export function ReviewPanel({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const flows = flowLinks(lang);
  const states = stateLinks(lang);
  const { data } = useAppState();
  const hasModel = data?.agent.mode === "model";
  const reset = async () => {
    const m = await loadMock();
    m.resetPrototype();
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith("ai-analyst:")).forEach((k) => sessionStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    await qc.resetQueries();
    onNavigate?.();
    navigate("/ask");
    notify(t.review.reset_done, { type: "success" });
  };
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col divide-y divide-border">
        {t.review.flows.map((fl, i) => (
          <li key={fl.id} className="flex items-start gap-3 py-2.5">
            <span className="w-8 shrink-0 font-mono text-2xs text-text-muted">{fl.id}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text">{fl.title}</span>
              <span className="block text-2xs text-text-muted">{fl.how}</span>
            </span>
            <Button variant="outline" size="xs" render={<Link to={flows[i]!} onClick={onNavigate} />} nativeButton={false}>
              {t.review.start}
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <h3 className="text-2xs font-medium text-text-muted">{t.review.extra}</h3>
        <ul className="mt-1 flex flex-col divide-y divide-border">
          {t.review.states.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-text">{s.title}</span>
                <span className="block text-2xs text-text-muted">{s.how}</span>
              </span>
              <Button variant="outline" size="xs" render={<Link to={states[i]!} onClick={onNavigate} />} nativeButton={false}>
                {t.review.start}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            (await loadMock()).simulateChatAppCall();
            await qc.invalidateQueries();
            notify(t.review.simulate_chat_done, { type: "success" });
          }}
        >
          {t.review.simulate_chat}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const ok = (await loadMock()).simulateWatchChange();
            await qc.invalidateQueries();
            notify(ok ? t.review.simulate_watch_done : t.review.simulate_watch_none, { type: ok ? "success" : "info" });
          }}
        >
          {t.review.simulate_watch}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            (await loadMock()).simulateModelKey(!hasModel);
            await qc.invalidateQueries();
            notify(hasModel ? t.review.remove_key_done : t.review.simulate_key_done, { type: "success" });
          }}
        >
          {hasModel ? t.review.remove_key : t.review.simulate_key}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            (await loadMock()).simulateAuditFix(!data?.audit_fixed);
            await qc.invalidateQueries();
            notify(data?.audit_fixed ? t.review.undo_fix_done : t.review.simulate_fix_done, { type: "success" });
          }}
        >
          {data?.audit_fixed ? t.review.undo_fix : t.review.simulate_fix}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void reset()}>
          {t.review.reset}
        </Button>
      </div>
    </div>
  );
}

export function ReviewMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.review.title}</DialogTitle>
          <DialogDescription>
            {t.review.lead} {t.review.shortcut}{" "}
            <Link to="/tour" onClick={() => setOpen(false)} className="font-medium text-accent hover:underline">
              {t.review.open_tour}
            </Link>
          </DialogDescription>
        </DialogHeader>
        <ReviewPanel onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
