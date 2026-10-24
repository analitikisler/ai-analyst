// The composer, on shadcn InputGroup (the pattern of AI Elements prompt-input without its `ai` types and attachment
// machinery): one 6 px box, a textarea that grows to 6 lines, the send button inside at the right as an icon (Stop
// while an answer runs), an optional context chip on top. Enter sends, Shift and Enter add a line. The model status
// is one quiet line under the box, said once here instead of on every answer.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { ArrowUpIcon, SquareIcon, XIcon } from "lucide-react";
import { useAppState } from "@/api/queries";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { fmt, useT } from "@/i18n";

export interface ComposerHandle {
  focus: () => void;
}

export interface ComposerProps {
  onSubmit: (question: string) => void;
  onStop: () => void;
  running: boolean;
  context?: string | null;
  onRemoveContext?: () => void;
  /** Kept per conversation in this browser (09-ux.md S02). */
  draftKey?: string;
  className?: string;
  /** Esc stops a running turn (the full Ask page; the sheet uses Esc to close). */
  escStops?: boolean;
  /** Show the model line under the box. */
  modelLine?: boolean;
}

const readDraft = (k?: string) => {
  try {
    return k ? (sessionStorage.getItem(`ai-analyst:draft:${k}`) ?? "") : "";
  } catch {
    return "";
  }
};
const writeDraft = (k: string | undefined, v: string) => {
  try {
    if (k) {
      if (v) sessionStorage.setItem(`ai-analyst:draft:${k}`, v);
      else sessionStorage.removeItem(`ai-analyst:draft:${k}`);
    }
  } catch {
    /* drafts are a convenience */
  }
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ onSubmit, onStop, running, context, onRemoveContext, draftKey, className, escStops, modelLine = true }, ref) {
  const t = useT();
  const { data, isError } = useAppState();
  const [value, setValue] = useState(() => readDraft(draftKey));
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }));
  useEffect(() => setValue(readDraft(draftKey)), [draftKey]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 22 + 16)}px`;
  }, [value]);
  const offline = isError;
  const submit = () => {
    const q = value.trim();
    if (!q || running || offline) return;
    onSubmit(q);
    setValue("");
    writeDraft(draftKey, "");
  };
  const id = `composer-${draftKey ?? "x"}`;
  const agent = data?.agent;
  const model = agent ? (agent.mode === "planner" ? t.shell.status.planner : [agent.provider_label, agent.model_label].filter(Boolean).join(" · ")) : "";
  return (
    <div className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <InputGroup className="rounded-lg border-border-strong bg-surface">
          {context && (
            <InputGroupAddon align="block-start">
              <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-sm border border-border bg-surface-2 pr-0.5 pl-2 text-xs font-normal text-text-muted">
                <span className="truncate">{fmt(t.ask.context_chip, { name: context })}</span>
                {onRemoveContext && (
                  <button type="button" onClick={onRemoveContext} aria-label={t.ask.context_remove} className="inline-flex size-5 items-center justify-center rounded-xs hover:bg-surface hover:text-text">
                    <XIcon size={12} strokeWidth={1.75} aria-hidden />
                  </button>
                )}
              </span>
            </InputGroupAddon>
          )}
          <label htmlFor={id} className="sr-only">
            {t.ask.composer.label}
          </label>
          <InputGroupTextarea
            id={id}
            ref={area}
            rows={1}
            value={value}
            disabled={offline}
            onChange={(e) => {
              setValue(e.target.value);
              writeDraft(draftKey, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape" && running && escStops) {
                e.preventDefault();
                onStop();
              }
            }}
            placeholder={offline ? t.ask.composer.offline : t.ask.composer.placeholder}
            aria-describedby={`${id}-hint`}
            aria-keyshortcuts="Meta+K Control+K"
            className="min-h-11 px-3 pt-3 text-base leading-[22px] text-text placeholder:text-text-subtle sm:text-[15px]"
          />
          <InputGroupAddon align="block-end" className="justify-end">
            {running ? (
              <InputGroupButton type="button" variant="outline" size="icon-sm" onClick={onStop} aria-label={t.ask.composer.stop} title={t.ask.composer.stop} className="pointer-coarse:size-10">
                <SquareIcon strokeWidth={1.75} className="fill-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={!value.trim() || offline} aria-label={t.ask.composer.send} title={t.ask.composer.send} className="pointer-coarse:size-10">
                <ArrowUpIcon strokeWidth={2} />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      <span id={`${id}-hint`} className="sr-only">
        {t.ask.composer.hint}
      </span>
      {modelLine && model && (
        <p className={cn("mt-2 text-center text-2xs text-text-subtle")}>
          <Link to="/settings/model" className="rounded-sm hover:text-text-muted hover:underline">
            {model}
          </Link>
        </p>
      )}
    </div>
  );
});
