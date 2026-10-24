// Add a model key (09-ux.md S12e, F9): key (password, show and hide), model id, base URL for OpenAI-compatible
// servers; "Test and save" tests first and saves only on a pass. A rejected key shows the provider's reason under
// the field, never a toast. The test is scripted: a key starting "sk-ant-" works for Anthropic.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useCall } from "@/api/queries";
import type { ModelTestResult, ProviderId } from "@/api/types";
import { StatusGlyph } from "@/components/art/StatusGlyph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fmt, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { describeError } from "@/lib/errors";
import { notify } from "@/lib/notify";

const NAME: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini", openai_compatible: "OpenAI-compatible" };
const MODEL: Record<ProviderId, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5.5", gemini: "gemini-pro-latest", openai_compatible: "llama3.3" };
const WHERE: Record<ProviderId, string> = { anthropic: "https://console.anthropic.com/settings/keys", openai: "https://platform.openai.com/api-keys", gemini: "https://aistudio.google.com/apikey", openai_compatible: "https://ollama.com/download" };

export function KeySheet() {
  const t = useT();
  const f = useFormat();
  const call = useCall();
  const [params, setParams] = useSearchParams();
  const provider = params.get("provider") as ProviderId | null;
  const open = !!provider && provider in NAME;
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [model, setModel] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (open && provider) {
      setKey("");
      setShow(false);
      setModel(MODEL[provider]);
      setBase(provider === "openai_compatible" ? "http://127.0.0.1:11434/v1" : "");
      setResult(null);
      setFailure(null);
    }
  }, [open, provider]);
  if (!provider) return null;
  const compat = provider === "openai_compatible";
  const name = NAME[provider];
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("provider");
    setParams(next);
  };
  const save = async () => {
    try {
      await testAndSave();
    } catch (e) {
      setBusy(false);
      setFailure(describeError(t, e, f.bytes));
    }
  };
  const testAndSave = async () => {
    setBusy(true);
    setResult(null);
    setFailure(null);
    const input = { provider, key: key || undefined, model, base_url: compat ? base : undefined };
    const r = await call("test_model_key", input);
    if (!r.ok) {
      setResult(r);
      setBusy(false);
      return;
    }
    setResult(r);
    await new Promise((res) => setTimeout(res, 700));
    await call("save_model_key", input);
    setBusy(false);
    notify(fmt(t.set.key.saved_toast, { provider: name }), { type: "success" });
    close();
  };
  const err = result && !result.ok ? result.error : null;
  const errText = err ? fmt(t.set.key.err[err.code], { provider: name, model, url: base }) : "";
  const disabled = busy || (!compat && !key.trim()) || !model.trim() || (compat && !base.trim());
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-base font-semibold">{fmt(t.set.key.title, { provider: name })}</SheetTitle>
          <SheetDescription>{fmt(t.set.key.storage, { provider: name })}</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled) void save();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {compat && (
              <div className="flex flex-col gap-1">
                <label htmlFor="k-base" className="text-2xs font-medium text-text-muted">
                  {t.set.key.base_url}
                </label>
                <Input id="k-base" value={base} onChange={(e) => setBase(e.target.value)} readOnly={busy} className="font-mono" aria-invalid={err?.code === "unreachable" || undefined} aria-describedby="k-base-hint" autoComplete="off" spellCheck={false} />
                <p id="k-base-hint" className="text-2xs text-text-subtle">
                  {t.set.key.base_url_hint}
                </p>
                {err?.code === "unreachable" && <ErrLine text={errText} />}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="k-key" className="text-2xs font-medium text-text-muted">
                {compat ? t.set.key.optional : t.set.key.key}
              </label>
              <div className="flex gap-2">
                <Input id="k-key" type={show ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)} readOnly={busy} className="font-mono" autoComplete="off" spellCheck={false} aria-invalid={err?.code === "key_rejected" || undefined} />
                <Button type="button" variant="outline" size="icon" aria-label={show ? t.set.key.hide : t.set.key.show} onClick={() => setShow((v) => !v)}>
                  {show ? <EyeOffIcon strokeWidth={1.75} /> : <EyeIcon strokeWidth={1.75} />}
                </Button>
              </div>
              {!compat && !key.trim() && <p className="text-2xs text-text-subtle">{t.set.key.empty}</p>}
              {(err?.code === "key_rejected" || err?.code === "rate_limited" || (err?.code === "unreachable" && !compat)) && <ErrLine text={`${errText} ${fmt(t.err.details, { code: `${err.status ?? ""} ${err.detail ?? ""}`.trim() })}`} />}
              <a href={WHERE[provider]} target="_blank" rel="noreferrer" className="self-start text-2xs font-medium text-accent hover:underline">
                {t.set.key.where} <span className="sr-only">{t.common.opens_tab}</span>
              </a>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="k-model" className="text-2xs font-medium text-text-muted">
                {t.set.key.model}
              </label>
              <Input id="k-model" value={model} onChange={(e) => setModel(e.target.value)} readOnly={busy} className="font-mono" aria-invalid={err?.code === "model_not_found" || undefined} autoComplete="off" spellCheck={false} />
              {err?.code === "model_not_found" && <ErrLine text={errText} />}
            </div>
            {failure && <ErrLine text={failure} />}
            {result?.ok && (
              <p className="flex items-center gap-1.5 text-[13px] text-success" aria-live="polite">
                <StatusGlyph tone="ok" size={14} />
                {fmt(t.set.key.ok, { model: result.model, s: f.dec(result.seconds ?? 1, 1) })}
              </p>
            )}
          </div>
          <SheetFooter className="flex-row justify-end border-t border-border">
            <Button type="button" variant="ghost" onClick={close}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={disabled}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? t.set.key.testing : t.set.key.test_save}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ErrLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-2xs text-danger" role="alert">
      <StatusGlyph tone="bad" size={12} className="mt-0.5 shrink-0" />
      {text}
    </p>
  );
}
