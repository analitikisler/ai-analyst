// The tally (Tally README §7, 08-art.md §6.2, 07-creative.md §3 D): the system that owns the number is a hollow
// track, the measured figure is the data blue, the gap is hatched (red only when the verdict is bad, with the ✗
// and the word in the same tally), and a 1 px tick marks the tolerance edge on each track (never across a label). Bars are aria-hidden; labels,
// counts, Δ and verdict are text, and a visually hidden sentence reads the whole tally.
import { useId, type ReactNode } from "react";
import { cn } from "cn";
import type { CheckResult, Unit, Verdict } from "@/api/types";
import { DeltaFigure, Marked } from "@/components/kit/Mark";
import { Status } from "@/components/kit/Status";
import { fmt, useBilingual, useT } from "@/i18n";
import { useFormat } from "@/lib/format";

/** A hatch on an SVG pattern (no CSS gradients): 1.5 px stripes 5 px apart. */
export function Hatch({ tone, angle = 135, className }: { tone: "gap" | "neutral" | "partial"; angle?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const fill = tone === "gap" ? "var(--color-danger)" : tone === "partial" ? "var(--color-chart-1)" : "var(--color-border-strong)";
  return (
    <svg aria-hidden className={cn("absolute inset-0 size-full", className)} preserveAspectRatio="none">
      <defs>
        <pattern id={`h${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
          <rect width="1.5" height="5" fill={fill} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#h${id})`} />
    </svg>
  );
}

interface Geometry {
  /** Both bars share one scale: the larger of the two figures is 100%. */
  sourceW: number;
  measuredW: number;
  /** The blue fill: the measured figure when under, the source when over (the rest is the over-count). */
  fill: number;
  gapFrom: number;
  gapTo: number;
  tick: number | null;
  under: boolean;
}

function geometry(source: number, measured: number, tolerance: number): Geometry {
  const max = Math.max(source, measured, 1);
  const s = source / max;
  const m = measured / max;
  const under = measured <= source;
  if (under) return { sourceW: s, measuredW: m, fill: m, gapFrom: m, gapTo: s, tick: (1 - tolerance) * s, under };
  const t = (1 + tolerance) * s;
  return { sourceW: s, measuredW: 1, fill: s, gapFrom: s, gapTo: 1, tick: t <= 1 ? t : null, under };
}

const gapTone = (v: Verdict): "gap" | "neutral" => (v === "does_not_add_up" ? "gap" : "neutral");
const hasGap = (g: Geometry) => g.gapTo - g.gapFrom > 0.0005;

/** The tolerance tick on one track: the track's height plus 1 px above and below, never across a label row. */
function TrackTick({ at, label }: { at: number | null; label?: string }) {
  if (at == null) return null;
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute -top-px -bottom-px w-px bg-border-strong" style={{ left: `${at * 100}%` }} />
      {label && (
        <span aria-hidden className="pointer-events-none absolute top-[calc(100%+3px)] -translate-x-1/2 font-mono text-2xs leading-3 whitespace-nowrap text-text-muted" style={{ left: `${at * 100}%` }}>
          {label}
        </span>
      )}
    </>
  );
}

/** The system that owns the number: a hollow track to its share of the scale. */
function SourceTrack({ g, height, tick }: { g: Geometry; height: number; tick?: number | null }) {
  return (
    <div className="relative" style={{ height }}>
      <div className="absolute inset-y-0 left-0 rounded-xs border border-chart-ref-edge bg-surface" style={{ width: `${g.sourceW * 100}%` }} />
      <TrackTick at={tick ?? null} />
    </div>
  );
}

/** The measured figure: blue to the measured value (under) or to the source (over). The gap is hatched: under, inside
 *  the dashed source outline; over, on `surface` inside a dashed outline in `bad` (never hatch over blue). */
function MeasuredTrack({ g, verdict, height, play, tick, tickLabel }: { g: Geometry; verdict: Verdict; height: number; play?: boolean; tick?: number | null; tickLabel?: string }) {
  const bad = verdict === "does_not_add_up";
  const inset = g.under && height > 12 ? 2 : g.under ? 1 : 0;
  const gap = hasGap(g);
  return (
    <div className="relative" style={{ height }}>
      {g.under && gap && <div className="absolute inset-y-0 left-0 rounded-xs border border-dashed border-border-strong" style={{ width: `${g.sourceW * 100}%` }} />}
      <div
        className={cn("absolute rounded-xs bg-chart-1", play && "origin-left animate-[aia-grow_400ms_var(--ease-out)_both]")}
        style={{ top: inset, bottom: inset, left: inset, width: `calc(${g.fill * 100}% - ${inset * 2}px)` }}
      />
      {gap && (
        <div
          className={cn("absolute overflow-hidden", !g.under && cn("rounded-xs border border-dashed bg-surface", bad ? "border-danger" : "border-border-strong"), play && "animate-[aia-fade-in_160ms_var(--ease-out)_400ms_both]")}
          style={g.under ? { top: inset, bottom: inset, left: `${g.gapFrom * 100}%`, width: `calc(${(g.gapTo - g.gapFrom) * 100}% - ${inset}px)` } : { top: 0, bottom: 0, left: `${g.gapFrom * 100}%`, width: `${(g.gapTo - g.gapFrom) * 100}%` }}
        >
          <Hatch tone={gapTone(verdict)} />
        </div>
      )}
      <TrackTick at={tick ?? null} label={tickLabel} />
    </div>
  );
}

export interface TallyProps {
  result: CheckResult;
  /** stacked (narrow containers) or inline (≥ 480 px). */
  form?: "stacked" | "inline";
  /** The tally is the section's one figure (check page): its Δ carries the mark. */
  mark?: boolean;
  /** Settle once, for a fresh answer. */
  play?: boolean;
  showLabel?: boolean;
  className?: string;
}

/** The sentence a screen reader hears for a tally (09-ux.md §5.3). */
export function useTallySentence(c: CheckResult) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  return fmt(t.tally.sr, {
    check: pick(c.label),
    period: f.range(c.from, c.to),
    expected_label: pick(c.expected.label),
    expected: f.value(c.expected.value, c.unit),
    measured_label: pick(c.measured.label),
    measured: f.value(c.measured.value, c.unit),
    delta: signedValue(f, c.delta, c.unit),
    pct: f.pct(c.delta_pct, 1, true),
    t: f.pct(c.tolerance, 0),
    verdict: t.ask.verdict[c.verdict],
  });
}

export function signedValue(f: ReturnType<typeof useFormat>, v: number | null, unit: Unit) {
  if (v == null) return f.dash;
  const s = f.value(Math.abs(v), unit);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function Tally({ result: c, form = "stacked", mark, play, showLabel = true, className }: TallyProps) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const sr = useTallySentence(c);
  const g = geometry(c.expected.value ?? 0, c.measured.value ?? 0, c.tolerance);
  const tickLabel = `${g.under ? "−" : "+"}${f.pct(c.tolerance, 0)}`;
  const deltaText = signedValue(f, c.delta, c.unit);
  const figure = <DeltaFigure value={deltaText} className={form === "inline" ? "text-[28px] leading-8 text-text-strong" : "text-2xl leading-7 text-text-strong"} />;
  const rows = (
    <>
      <Row label={pick(c.expected.label)} sub={t.tally.source} value={f.value(c.expected.value, c.unit)} form={form}>
        <SourceTrack g={g} height={18} tick={g.tick} />
      </Row>
      <Row label={pick(c.measured.label)} sub={t.tally.measured} value={f.value(c.measured.value, c.unit)} form={form}>
        <MeasuredTrack g={g} verdict={c.verdict} height={18} play={play} tick={g.tick} tickLabel={tickLabel} />
      </Row>
    </>
  );
  return (
    <figure className={cn("relative min-w-0", className)} aria-label={sr}>
      {showLabel && <figcaption className="mb-2 text-2xs font-medium text-text-muted">{t.tally.label}</figcaption>}
      <div aria-hidden className={cn("relative", g.tick != null && "pb-4")}>
        {form === "inline" ? <div className="grid grid-cols-[minmax(0,max-content)_minmax(6rem,1fr)_auto] items-center gap-x-3.5 gap-y-2">{rows}</div> : <div className="flex flex-col gap-3">{rows}</div>}
      </div>
      <div aria-hidden className="mt-2 border-t border-text pt-3.5">
        <p className="text-[13px] leading-[18px] text-text-muted">{t.tally.difference}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {mark ? <Marked draw={play}>{figure}</Marked> : figure}
          <Status verdict={c.verdict} />
        </div>
        <p className="mt-1.5 font-mono text-2xs text-text-muted tnum">
          {f.pct(c.delta_pct, 1, true)} · {fmt(t.ask.tolerance, { t: f.pct(c.tolerance, 0) })} · {f.range(c.from, c.to)}
        </p>
        {c.reason && <p className="mt-1.5 text-[13px] leading-[18px] text-text-muted">{pick(c.reason)}</p>}
      </div>
    </figure>
  );
}

function Row({ label, sub, value, form, children }: { label: string; sub: string; value: string; form: "stacked" | "inline"; children: ReactNode }) {
  if (form === "inline") {
    return (
      <>
        <span className="text-[13px] leading-[18px] text-text-muted">
          {label} <span className="text-text-subtle">· {sub}</span>
        </span>
        {children}
        <span className="text-right font-mono text-[13px] font-medium text-text-strong tnum">{value}</span>
      </>
    );
  }
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] leading-[18px] text-text-muted">
          {label} <span className="text-text-subtle">· {sub}</span>
        </span>
        <span className="font-mono text-[13px] font-medium text-text-strong tnum">{value}</span>
      </div>
      {children}
    </div>
  );
}

/** Compact tally for tiles and phones: the same order as the full tally (source first, measured second, each with
 *  its label and count), 10 px tracks, the tolerance tick, then Δ, the status and the tolerance line. */
export function TallyCompact({ result: c, mark, className }: { result: CheckResult; mark?: boolean; className?: string }) {
  const t = useT();
  const f = useFormat();
  const pick = useBilingual();
  const sr = useTallySentence(c);
  const g = geometry(c.expected.value ?? 0, c.measured.value ?? 0, c.tolerance);
  const tickLabel = `${g.under ? "−" : "+"}${f.pct(c.tolerance, 0)}`;
  const figure = <DeltaFigure value={f.pct(c.delta_pct, 1, true)} className="text-2xl leading-7 text-text-strong" />;
  const label = (text: string, sub: string, value: string) => (
    <p className="flex min-w-0 items-baseline justify-between gap-2 text-2xs leading-4">
      <span className="min-w-0 truncate text-text-muted">
        {text} <span className="text-text-subtle">· {sub}</span>
      </span>
      <span className="shrink-0 font-mono font-medium text-text-strong tnum">{value}</span>
    </p>
  );
  return (
    <figure className={cn("min-w-0", className)} aria-label={sr}>
      <div aria-hidden className={cn("flex flex-col gap-1", g.tick != null && "pb-3.5")}>
        {label(pick(c.expected.label), t.tally.source, f.value(c.expected.value, c.unit))}
        <SourceTrack g={g} height={10} tick={g.tick} />
        <div className="mt-1">{label(pick(c.measured.label), t.tally.measured, f.value(c.measured.value, c.unit))}</div>
        <MeasuredTrack g={g} verdict={c.verdict} height={10} tick={g.tick} tickLabel={tickLabel} />
      </div>
      <div aria-hidden className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {mark ? <Marked>{figure}</Marked> : figure}
        <Status verdict={c.verdict} />
      </div>
      <p aria-hidden className="mt-1 font-mono text-2xs text-text-muted tnum">
        {fmt(t.tally.compact_meta, { delta: signedValue(f, c.delta, c.unit), t: f.pct(c.tolerance, 0) })}
      </p>
      {c.reason && <p className="mt-1 text-2xs leading-4 text-text-muted">{pick(c.reason)}</p>}
    </figure>
  );
}

/** Micro tally beside a finding or the 404 (Tally `.tally-micro`). Decorative; the Δ is the text. */
export function TallyMicro({ expected, measured, verdict, width = 56, className }: { expected: number; measured: number; verdict: Verdict; width?: number; className?: string }) {
  const g = geometry(expected, measured, 0);
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 flex-col gap-0.5", className)} style={{ width }}>
      <SourceTrack g={g} height={8} />
      <MeasuredTrack g={g} verdict={verdict} height={8} />
    </span>
  );
}
