// The assistant's reply in the chat (owner round 3; 07-creative.md §3; 08-art.md §6.1): unboxed, full column width,
// prose first. The verdict line and Δ (with the one orange mark), the sentence (it streams in), how the question was
// read, then the evidence as an inline block (chart and tally keep their design), where the gap is, the finding, and
// the folded working (definition, SQL). A "why" reply explains instead of repeating the tally. Message actions are
// small ghost icons under the reply. Parts that do not apply are left out, never left empty.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { CopyIcon, EyeIcon, PinIcon, RotateCcwIcon, ScanSearchIcon } from "lucide-react";
import { useAppState } from "@/api/queries";
import type { Answer, CheckResult } from "@/api/types";
import { useOpenMetric, usePin, useWatchToggle } from "@/ask/hooks";
import { CheckBars, CheckEvidenceChart, DataTable, DiffChart, NoDeviceSplit, SplitBars, TrendChart } from "@/components/charts";
import { CodeBlock, DeltaBadge, DeltaFigure, Disclosure, Marked, Status } from "@/components/kit";
import { Hatch, signedValue, Tally } from "@/components/tally/Tally";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmt, plural, useBilingual, useLang, useT } from "@/i18n";
import { useFormat } from "@/lib/format";
import { notify } from "@/lib/notify";
import { ExploreBadge, ExploreChart, ExploreWorking } from "./Explore";
import { useOpenAudit } from "@/components/checks/AuditSheet";

export interface AnswerCardProps {
  answer: Answer;
  /** A fresh answer streams once: the sentence appears progressively, the evidence fades in after it. */
  fresh?: boolean;
  /** Narrow container (the 560 sheet): chart and tally stacked, tally first. */
  narrow?: boolean;
  /** The message actions, shown once the reply has streamed in. */
  actions?: ReactNode;
}

/** Answers whose sentence has already streamed in this session, so a re-mount does not replay it. */
const streamed = new Set<string>();
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Text that appears a few words at a time, then calls `onDone`. */
function StreamText({ id, text, active, onDone, className }: { id: string; text: string; active: boolean; onDone: () => void; className?: string }) {
  const words = text.split(/(\s+)/);
  const instant = !active || streamed.has(id) || reduceMotion();
  const [n, setN] = useState(instant ? words.length : 0);
  const done = useRef(instant);
  useEffect(() => {
    if (instant) {
      onDone();
      return;
    }
    const timer = setInterval(() => {
      setN((x) => {
        const next = Math.min(words.length, x + 4);
        if (next >= words.length && !done.current) {
          done.current = true;
          streamed.add(id);
          clearInterval(timer);
          setTimeout(onDone, 0);
        }
        return next;
      });
    }, 40);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return <p className={className}>{words.slice(0, n).join("")}</p>;
}

export function AnswerCard({ answer: a, fresh, narrow, actions }: AnswerCardProps) {
  const pick = useBilingual();
  const c = a.check;
  // The check leads only a check answer; a metric answer leads with its figure and the check sits below it.
  const checkLed = !!c && (a.kind === "check" || a.kind === "check_split");
  const checkBelow = !!c && !checkLed && a.kind !== "why" && !a.explore;
  const [revealed, setRevealed] = useState(!fresh || streamed.has(a.id));
  return (
    <div className="@container flex min-w-0 flex-col gap-3" aria-label={pick(a.title)}>
      {a.explore ? <ExploreHead answer={a} /> : a.kind === "why" && c ? <WhyHead check={c} /> : checkLed && c ? <CheckHead check={c} overall={a.overall ?? null} fresh={fresh} sentence={pick(a.sentence)} /> : <FigureHead answer={a} fresh={fresh} />}
      <StreamText id={a.id} text={pick(a.sentence)} active={!!fresh} onDone={() => setRevealed(true)} className="max-w-[68ch] text-[15px] leading-6 text-text" />
      {revealed && (
        <div className={cn("flex min-w-0 flex-col gap-3", fresh && "animate-[aia-fade-in_220ms_var(--ease-out)_both]")}>
          {a.interpretation && <p className="-mt-1 text-[13px] leading-[18px] text-text-muted">{pick(a.interpretation)}</p>}
          {a.explore ? (
            a.explore.shape !== "number" && (
              <div className="min-w-0 rounded-lg border border-border bg-surface p-3 sm:p-4">
                <ExploreChart x={a.explore} query={a.query} height={narrow ? 180 : 220} />
              </div>
            )
          ) : a.kind === "why" && c ? (
            <WhyBody answer={a} check={c} narrow={narrow} />
          ) : (
            <Evidence answer={a} fresh={fresh} narrow={narrow} />
          )}
          {checkBelow && c && (
            <section aria-label={pick(c.label)} className="rounded-lg border border-border bg-surface p-3 sm:p-4">
              <CheckHead check={c} overall={null} />
            </section>
          )}
          {c && a.kind === "check" && <WhereLine check={c} />}
          {c && a.kind !== "why" && c.findings.length > 0 && <FindingLine check={c} defaultOpen={a.kind === "check_split" && a.handmade} />}
          {a.explore ? (
            <div className="border-t border-border pt-1">
              <ExploreWorking x={a.explore} title={pick(a.title)} />
            </div>
          ) : (
          <div className="border-t border-border">
            <DefinitionRow answer={a} />
            <div className="border-t border-border">
              <SqlRow answer={a} />
            </div>
          </div>
          )}
        </div>
      )}
      {revealed && actions}
    </div>
  );
}

/** An exploratory reply: the badge first, then what was asked and, for one figure, the figure. No mark, no verdict. */
function ExploreHead({ answer: a }: { answer: Answer }) {
  const f = useFormat();
  const pick = useBilingual();
  const x = a.explore!;
  return (
    <header className="flex flex-col gap-2">
      <ExploreBadge />
      <p className="text-[13px] leading-[18px] font-medium text-text-muted">
        {pick(a.title)} · <span className="font-mono tnum">{f.range(x.spec.from, x.spec.to)}</span>
      </p>
      {x.shape === "number" && <p className="font-display text-[28px] leading-9 font-heading tracking-[-0.012em] text-text-strong tnum">{f.value(a.query.total, x.unit)}</p>}
    </header>
  );
}

function CheckHead({ check: c, overall, fresh, sentence }: { check: CheckResult; overall: Answer["overall"]; fresh?: boolean; sentence?: string }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const pctText = f.pct(c.delta_pct, 1, true);
  const diff = Math.abs(c.delta ?? 0);
  const fewerMore = (c.delta ?? 0) < 0 ? fmt(t.ask.fewer, { n: f.value(diff, c.unit) }) : fmt(t.ask.more_n, { n: f.value(diff, c.unit) });
  return (
    <header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Status verdict={c.verdict} size="lg" />
        <span className="font-mono text-[13px] text-text-muted tnum">{f.range(c.from, c.to)}</span>
      </div>
      <p className="mt-2 text-[13px] leading-[18px] font-medium text-text-muted">{pick(c.label)}</p>
      {c.verdict === "insufficient_data" ? (c.reason && !sentence?.includes(pick(c.reason)) ? <p className="mt-1 max-w-[68ch] text-[13px] leading-[18px] text-text-muted">{pick(c.reason)}</p> : null) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <Marked draw={fresh} label={fmt(t.ask.figure_label, { value: pctText })}>
            <DeltaFigure value={pctText} className={cn("text-[28px] leading-9 text-text-strong", fresh && "animate-[aia-fade-in_220ms_var(--ease-out)_both]")} />
          </Marked>
          <span className="text-sm text-text-muted tnum">
            {fewerMore} · {fmt(t.ask.tolerance, { t: f.pct(c.tolerance, 0) })}
            {c.out_of_tolerance_since && c.verdict === "does_not_add_up" ? ` · ${fmt(t.ask.since, { date: f.since(c.out_of_tolerance_since) })}` : ""}
          </span>
        </div>
      )}
      {overall && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-text-muted tnum">
          {fmt(t.tally.all_devices, { pct: f.pct(overall.delta_pct, 1, true) })}
          <Status verdict={overall.verdict} />
        </p>
      )}
    </header>
  );
}

/** A "why" reply opens with the check it explains, without the Δ figure: the figure was the previous reply. */
function WhyHead({ check: c }: { check: CheckResult }) {
  const f = useFormat();
  const pick = useBilingual();
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Status verdict={c.verdict} size="lg" />
      <span className="text-[13px] font-medium text-text-muted">{pick(c.label)}</span>
      <span className="font-mono text-[13px] text-text-muted tnum">{f.range(c.from, c.to)}</span>
    </header>
  );
}

function WhyBody({ answer: a, check: c, narrow }: { answer: Answer; check: CheckResult; narrow?: boolean }) {
  const t = useT();
  const openAudit = useOpenAudit();
  const lang = useLang();
  const f = useFormat();
  const pick = useBilingual();
  const w = a.why!;
  const section = "flex min-w-0 flex-col gap-2";
  const h = "text-sm font-semibold text-text-strong";
  const dims = t.dimensions.device as Record<string, string>;
  const fd = c.findings[0];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section className={section}>
        <h3 className={h}>{t.ask.why.started}</h3>
        {w.started && (
          <p className="text-[13px] leading-[18px] text-text">
            {fmt(t.ask.why.started_line, { t: f.pct(c.tolerance, 0), date: f.since(w.started) })}
            {w.release ? ` ${fmt(t.ask.why.release_line, { date: f.dateLong(w.started), r: w.release })}` : ""}
          </p>
        )}
        <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
          <DiffChart result={c} height={narrow ? 170 : 200} />
        </div>
      </section>
      <section className={section}>
        <h3 className={h}>{t.ask.why.where}</h3>
        <ul className="flex flex-col gap-1 text-[13px] leading-[18px]">
          {c.breakdown.map((b) => (
            <li key={b.key} className="flex flex-wrap items-center gap-x-3">
              <span className="w-20 text-text">{dims[b.key] ?? b.key}</span>
              <span className="w-16 font-mono text-text tnum">{f.pct(b.delta_pct, 1, true)}</span>
              <Status verdict={b.verdict} />
            </li>
          ))}
        </ul>
        {w.segment && w.narrower && <p className="text-[13px] leading-[18px] text-text">{fmt(t.ask.why.narrower, { segment: lang === "en" ? (dims[w.segment.key] ?? w.segment.key).toLowerCase() : (dims[w.segment.key] ?? w.segment.key), what: pick(w.narrower) })}</p>}
      </section>
      {fd && (
        <section className={section}>
          <h3 className={h}>{t.ask.why.found}</h3>
          <p className="flex flex-wrap items-start gap-2 text-[13px] leading-[18px] text-text">
            <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-border px-1.5 text-2xs text-text-muted">
              <ScanSearchIcon size={12} strokeWidth={1.75} aria-hidden />
              {fd.source}
            </span>
            <span className="min-w-0 flex-1">{pick(fd.text)}</span>
          </p>
        </section>
      )}
      <section className={section}>
        <h3 className={h}>{t.ask.why.next}</h3>
        {c.findings.some((x) => x.since) && (c.check === "ga4_vs_orders" || c.check === "ga4_rev_vs_revenue") && (
          <div>
            <Button size="sm" onClick={() => openAudit({ check: c.check })}>
              <ScanSearchIcon strokeWidth={1.75} data-icon="inline-start" />
              {t.audit.action}
            </Button>
          </div>
        )}
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-[18px] text-text">
          {w.next.map((x) => (
            <li key={x.en}>{pick(x)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function FigureHead({ answer: a, fresh }: { answer: Answer; fresh?: boolean }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const q = a.query;
  const cmp = q.comparison;
  const metric = a.metrics[0];
  return (
    <header>
      <p className="text-[13px] leading-[18px] font-medium text-text-muted">
        {metric ? pick(metric.label) : ""} · <span className="font-mono tnum">{f.range(q.from, q.to)}</span>
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <Marked draw={fresh}>
          <span className={cn("font-display text-[28px] leading-9 font-heading tracking-[-0.012em] text-text-strong tnum", fresh && "animate-[aia-fade-in_220ms_var(--ease-out)_both]")}>{q.total == null ? t.format.no_data : f.value(q.total, q.unit)}</span>
        </Marked>
        {cmp && (
          <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted tnum">
            <DeltaBadge current={q.total} previous={cmp.total} unit={q.unit} size="md" />
            {fmt(t.ask.against, { value: f.value(cmp.total, q.unit), range: f.range(cmp.from, cmp.to) })}
          </span>
        )}
      </div>
    </header>
  );
}

function Evidence({ answer: a, fresh, narrow }: { answer: Answer; fresh?: boolean; narrow?: boolean }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const [table, setTable] = useState(false);
  const c = a.check;
  const title = a.metrics[0] ? pick(a.metrics[0].label) : "";
  const toggle = (
    <button type="button" onClick={() => setTable((v) => !v)} aria-pressed={table} className="rounded-sm text-2xs font-medium text-accent hover:underline">
      {table ? t.common.show_chart : t.common.show_table}
    </button>
  );
  const block = "min-w-0 rounded-lg border border-border bg-surface p-3 sm:p-4";
  if (a.kind === "number") return null;
  if (c && (a.kind === "check" || a.kind === "check_split")) {
    const split = a.kind === "check_split";
    const tableEl = (
      <DataTable
        label={pick(c.label)}
        dense
        maxHeight={240}
        rows={split ? c.breakdown.map((b) => ({ key: (t.dimensions.device as Record<string, string>)[b.key] ?? b.key, e: b.expected, m: b.measured, d: b.delta_pct })) : (c.series ?? []).map((p) => ({ key: f.date(p.date), e: p.expected, m: p.measured, d: p.expected && p.measured != null ? (p.measured - p.expected) / p.expected : null }))}
        columns={[
          { key: "k", label: split ? t.ask.by_device : t.check.chart, render: (r) => r.key },
          { key: "e", label: pick(c.expected.label), num: true, render: (r) => f.value(r.e, c.unit) },
          { key: "m", label: pick(c.measured.label), num: true, render: (r) => f.value(r.m, c.unit) },
          { key: "d", label: t.tally.difference, num: true, render: (r) => f.pct(r.d, 1, true) },
        ]}
      />
    );
    const header = (
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-2xs font-medium text-text-muted">{split ? t.ask.by_device : t.check.chart}</span>
        {toggle}
      </div>
    );
    const evidence = split ? (
      <>
        {header}
        {c.breakdown_available === false ? <NoDeviceSplit /> : table ? tableEl : <CheckBars result={c} />}
      </>
    ) : table ? (
      <>
        {header}
        {tableEl}
      </>
    ) : (
      <CheckEvidenceChart result={c} height={narrow ? 180 : 220} extra={toggle} />
    );
    return (
      <div className={cn("grid gap-3", !narrow && "@min-[600px]:grid-cols-[7fr_5fr]")}>
        <div className={cn(block, "order-2", !narrow && "@min-[600px]:order-1")}>{evidence}</div>
        <div className={cn(block, "order-1", !narrow && "@min-[600px]:order-2")}>
          <Tally result={c} play={fresh} />
        </div>
      </div>
    );
  }
  const q = a.query;
  return (
    <div className={block}>
      <div className="mb-2 flex justify-end">{toggle}</div>
      {table ? (
        <DataTable
          label={title}
          dense
          maxHeight={280}
          rows={q.rows}
          columns={[
            { key: "k", label: a.kind === "split" ? (q.group_by === "device" ? t.ask.by_device : t.ask.by_channel) : t.check.chart, render: (r) => (a.kind === "split" ? ((t.dimensions.channel as Record<string, string>)[r.key] ?? (t.dimensions.device as Record<string, string>)[r.key] ?? r.key) : f.date(r.key, true)) },
            { key: "v", label: title, num: true, render: (r) => f.value(r.value, q.unit) },
          ]}
        />
      ) : a.kind === "split" ? (
        <SplitBars query={q} title={title} />
      ) : (
        <TrendChart query={q} type={q.group_by === "day" ? "line" : "column"} title={title} height={narrow ? 180 : 240} showPrevious={q.group_by === "day"} />
      )}
      {q.group_by === "week" && <p className="mt-2 text-2xs text-text-muted">{fmt(t.dash.complete_weeks, { range: f.range(q.from, q.to) })}</p>}
    </div>
  );
}

/** "Mobile −15.6% does not add up · Desktop −1.6% adds up", only when one segment carries the gap. */
function WhereLine({ check: c }: { check: CheckResult }) {
  const t = useT();
  const f = useFormat();
  if (c.breakdown_available === false) return <NoDeviceSplit />;
  const bad = c.breakdown.filter((b) => b.verdict === "does_not_add_up");
  const ok = c.breakdown.filter((b) => b.verdict === "adds_up");
  if (c.verdict !== "does_not_add_up" || bad.length !== 1 || !ok.length) return null;
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-[18px]">
        <span className="text-text-muted">{t.ask.where}:</span>
        {c.breakdown.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-2">
            <span className="text-text">{(t.dimensions.device as Record<string, string>)[b.key] ?? b.key}</span>
            <span className="font-mono text-text tnum">{f.pct(b.delta_pct, 1, true)}</span>
            <Status verdict={b.verdict} />
          </span>
        ))}
      </p>
      <Disclosure label={t.ask.by_device} className="mt-1">
        <DataTable
          label={t.ask.by_device}
          dense
          rows={c.breakdown}
          columns={[
            { key: "k", label: t.ask.by_device, render: (b) => (t.dimensions.device as Record<string, string>)[b.key] ?? b.key },
            { key: "e", label: <Label text={c.expected.label} />, num: true, render: (b) => f.value(b.expected, c.unit) },
            { key: "m", label: <Label text={c.measured.label} />, num: true, render: (b) => f.value(b.measured, c.unit) },
            { key: "d", label: t.tally.difference, num: true, render: (b) => f.pct(b.delta_pct, 1, true) },
            { key: "v", label: t.checks.col.verdict, render: (b) => <Status verdict={b.verdict} /> },
          ]}
        />
      </Disclosure>
    </div>
  );
}

const Label = ({ text }: { text: { en: string; tr: string } }) => <>{useBilingual()(text)}</>;

function FindingLine({ check: c, defaultOpen }: { check: CheckResult; defaultOpen?: boolean }) {
  const t = useT();
  const pick = useBilingual();
  const [open, setOpen] = useState(!!defaultOpen);
  const fd = c.findings[0]!;
  const text = pick(fd.text);
  const cut = text.indexOf(":");
  const head = cut > 0 ? text.slice(0, cut) : text;
  const rest = cut > 0 ? text.slice(cut + 1).trim() : "";
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 text-[13px] leading-[18px]">
      <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-border px-1.5 text-2xs text-text-muted">
        <ScanSearchIcon size={12} strokeWidth={1.75} aria-hidden />
        {fd.source}
      </span>
      <span className="min-w-0 flex-1 text-text">
        {head}
        {open && rest ? `: ${rest}` : ""}
        {rest && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="ml-2 rounded-sm font-medium text-accent hover:underline">
            {open ? t.ask.less : t.ask.more}
          </button>
        )}
      </span>
      {c.verdict === "does_not_add_up" && fd.since && <Status verdict="does_not_add_up" word={t.ask.finding_status} />}
    </div>
  );
}

function DefinitionRow({ answer: a }: { answer: Answer }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const openMetric = useOpenMetric();
  const meta = fmt(t.ask.definition_meta, { metrics: a.metrics.map((m) => `${pick(m.label)} v${m.version}`).join(" · "), date: f.date(a.query.to, true) });
  return (
    <Disclosure label={t.ask.definition} meta={meta}>
      <ul className="flex flex-col gap-3">
        {a.metrics.map((m) => (
          <li key={m.id} className="text-[13px] leading-[18px]">
            <p className="font-medium text-text">
              {pick(m.label)} <span className="font-mono text-text-muted">v{m.version}</span>
            </p>
            <p className="mt-0.5 max-w-[66ch] text-text-muted">{pick(m.description)}</p>
            <button type="button" onClick={() => openMetric(m.id)} className="mt-1 rounded-sm font-medium text-accent hover:underline">
              {t.ask.open_definition}
            </button>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function SqlRow({ answer: a }: { answer: Answer }) {
  const t = useT();
  const lang = useLang();
  const sqls = a.check ? [a.check.sql.expected, a.check.sql.measured] : [a.query.sql, ...(a.query.comparison ? [a.query.comparison.sql] : [])];
  return (
    <Disclosure label={plural(lang, sqls.length, t.ask.sql, { n: sqls.length })}>
      <div className="flex flex-col gap-2">
        {sqls.map((s, i) => (
          <CodeBlock key={i} code={s} language="sql" title={`${i + 1} / ${sqls.length}`} maxHeight={260} />
        ))}
      </div>
    </Disclosure>
  );
}

/** One ghost icon button with its tooltip (AI Elements "message actions", on shadcn Button and Tooltip). */
export function ActionButton({ label, onClick, children, pressed, render }: { label: string; onClick?: () => void; children: React.ReactNode; pressed?: boolean; render?: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={render ?? <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} onClick={onClick} className={cn("text-text-muted hover:text-text", pressed && "text-text")} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Copy, pin (to the last dashboard; the menu picks another or a new one), watch (a check), ask again. Shown on
 *  hover with a fine pointer, always on touch and on the latest reply. */
export function MessageActions({ answer: a, question, always, onAsk, onNewDashboard }: { answer: Answer; question: string; always?: boolean; onAsk: (q: string) => void; onNewDashboard?: (id: string) => void }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const { data } = useAppState();
  const pin = usePin();
  const toggleWatch = useWatchToggle();
  const c = a.check;
  const pinned = data?.pins.find((p) => p.answer_id === a.id);
  const watching = !!c && !!data?.watches.some((w) => w.check === c.check);
  const copy = async () => {
    const lines = [pick(a.sentence)];
    if (c) lines.push(`${pick(c.expected.label)}: ${f.value(c.expected.value, c.unit)} · ${pick(c.measured.label)}: ${f.value(c.measured.value, c.unit)} · ${t.tally.difference}: ${signedValue(f, c.delta, c.unit)} (${f.pct(c.delta_pct, 1, true)})`);
    lines.push(a.metrics.map((m) => `${pick(m.label)} v${m.version}`).join(" · "));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      notify(t.ask.toast.copied_text, { type: "success" });
    } catch {
      notify(t.set.chat.copy_failed, { type: "error" });
    }
  };
  const dash = pinned ? data?.dashboards.find((d) => d.id === pinned.dashboard_id) : null;
  return (
    <div
      role="toolbar"
      aria-label={t.ask.actions.label}
      className={cn("-ml-1.5 flex items-center gap-0.5", !always && "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover/message:opacity-100 pointer-fine:focus-within:opacity-100")}
    >
      <ActionButton label={t.ask.actions.copy} onClick={() => void copy()}>
        <CopyIcon strokeWidth={1.75} />
      </ActionButton>
      {pinned ? (
        <ActionButton label={fmt(t.ask.actions.pinned, { dashboard: dash ? pick(dash.name) : "" })} pressed render={<Button variant="ghost" size="icon-sm" aria-label={fmt(t.ask.actions.pinned, { dashboard: dash ? pick(dash.name) : "" })} className="text-text" render={<Link to={`/dashboards/${pinned.dashboard_id}#tile-${pinned.tile_id}`} />} nativeButton={false} />}>
          <PinIcon strokeWidth={1.75} className="fill-current" />
        </ActionButton>
      ) : (
        <DropdownMenu>
          <ActionButton label={t.ask.actions.pin} render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t.ask.actions.pin} className="text-text-muted hover:text-text" />} />}>
            <PinIcon strokeWidth={1.75} />
          </ActionButton>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t.ask.pin_menu}</DropdownMenuLabel>
              {(data?.dashboards ?? []).map((d) => (
                <DropdownMenuItem key={d.id} onClick={() => void pin(a.id, d.id)}>
                  {fmt(t.ask.pin_to, { dashboard: pick(d.name) })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {onNewDashboard && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => onNewDashboard(a.id)}>{t.ask.pin_new}</DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {c &&
        (watching ? (
          <ActionButton label={t.ask.actions.watching} pressed render={<Button variant="ghost" size="icon-sm" aria-label={t.ask.actions.watching} aria-pressed className="text-text" render={<Link to={`/dashboards?check=${c.check}`} />} nativeButton={false} />}>
            <EyeIcon strokeWidth={1.75} />
          </ActionButton>
        ) : (
          <ActionButton label={t.ask.actions.watch} pressed={false} onClick={() => void toggleWatch(c.check, false)}>
            <EyeIcon strokeWidth={1.75} />
          </ActionButton>
        ))}
      <ActionButton label={t.ask.actions.again} onClick={() => onAsk(question)}>
        <RotateCcwIcon strokeWidth={1.75} />
      </ActionButton>
    </div>
  );
}

export { Hatch };
