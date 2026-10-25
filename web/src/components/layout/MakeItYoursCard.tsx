// "Make it yours" (DECISIONS.md §1, 09-ux.md S01): two optional steps that each work end to end, each opening its
// Settings section; a done step shows a check. Hidden once both are done or when the person hides it (remembered
// by the server preference, B19); "Not now" offers Undo.
import { Link } from "react-router";
import { CheckIcon, ChevronRightIcon, DatabaseIcon, KeyRoundIcon, XIcon } from "lucide-react";
import { useAppState, useCall } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { notify } from "@/lib/notify";

export function MakeItYoursCard({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const call = useCall();
  const { data } = useAppState();
  if (!data || data.preferences.make_it_yours === "hidden") return null;
  const dataDone = data.source.kind !== "demo";
  const modelDone = data.agent.mode !== "planner";
  if (dataDone && modelDone) return null;
  const hide = async () => {
    await call("set_preference", { key: "make_it_yours", value: "hidden" });
    notify(t.miy.hidden_toast, { actions: [{ label: t.common.undo, onClick: () => void call("set_preference", { key: "make_it_yours", value: "shown" }) }] });
  };
  const steps = [
    { to: "/settings/sources", label: t.miy.step_data, hint: t.miy.step_data_hint, icon: DatabaseIcon, done: dataDone },
    { to: "/settings/model", label: t.miy.step_model, hint: t.miy.step_model_hint, icon: KeyRoundIcon, done: modelDone },
  ];
  return (
    <section aria-labelledby="miy-title" className="relative rounded-lg border border-border bg-surface-2 p-3">
      <Button variant="ghost" size="icon-xs" className="absolute top-2 right-2" aria-label={t.miy.dismiss} title={t.miy.dismiss} onClick={() => void hide()}>
        <XIcon strokeWidth={1.75} />
      </Button>
      <h2 id="miy-title" className="pr-7 text-[13px] leading-[18px] font-semibold text-text-strong">
        {t.miy.title}
      </h2>
      <p className="mt-1 text-2xs text-text-muted">{t.miy.lead}</p>
      <ul className="mt-2 flex flex-col">
        {steps.map((s) => {
          const Icon = s.done ? CheckIcon : s.icon;
          const body = (
            <>
              <Icon size={16} strokeWidth={1.75} aria-hidden className={s.done ? "text-success" : "text-text-muted"} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-[18px] font-medium text-text">{s.done ? `${s.label} · ${t.miy.done}` : s.label}</span>
                {!s.done && <span className="block text-2xs text-text-muted">{s.hint}</span>}
              </span>
              {!s.done && <ChevronRightIcon size={14} strokeWidth={1.75} aria-hidden className="text-text-subtle" />}
            </>
          );
          return (
            <li key={s.label}>
              {s.done ? (
                <span className="flex min-h-8 items-center gap-2 py-1.5">{body}</span>
              ) : (
                <Link to={s.to} onClick={onNavigate} className="-mx-1 flex min-h-8 items-center gap-2 rounded-md px-1 py-1.5 hover:bg-surface">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
