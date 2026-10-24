// Ported from Overt (web/src/components/charts/Sparkline.tsx).
import { cn } from "cn";

export interface SparklineProps {
  /** Values in order; null = gap (never drawn as zero). */
  values: (number | null | undefined)[];
  color?: string;
  width?: number;
  height?: number;
  /** Fixed domain (e.g. [0, 1] for ratios). Defaults to the data's min/max. */
  domain?: [number, number];
  /** Flat tint under the line (no gradient, Tally). Additive metrics only, on a zero base. */
  area?: boolean;
  /** Dot on the last value. */
  showLast?: boolean;
  strokeWidth?: number;
  className?: string;
  /** Accessible summary. Hidden from AT when omitted. */
  label?: string;
}

/** Tiny inline trend line (pure SVG, cheap enough for table rows). Gaps break the line. */
export function Sparkline({
  values,
  color = "var(--color-chart-1)",
  width = 80,
  height = 24,
  domain,
  area = false,
  showLast = true,
  strokeWidth = 1.5,
  className,
  label,
}: SparklineProps) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const pad = strokeWidth + 1;
  if (nums.length === 0) {
    return (
      <svg width={width} height={height} className={className} aria-hidden={!label} role={label ? "img" : undefined} aria-label={label}>
        <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke="var(--color-border-strong)" strokeDasharray="2 3" />
      </svg>
    );
  }
  const [lo, hi] = domain ?? [Math.min(...nums), Math.max(...nums)];
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);

  // Split into contiguous segments so nulls render as gaps.
  const segments: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) cur.push({ i, v });
    else if (cur.length) {
      segments.push(cur);
      cur = [];
    }
  });
  if (cur.length) segments.push(cur);

  const lastIdx = values.map((v, i) => (typeof v === "number" ? i : -1)).filter((i) => i >= 0).pop()!;
  const lastVal = values[lastIdx] as number;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={!label}
    >
      {segments.map((seg, k) => {
        const d = seg.map((p, j) => `${j ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
        return (
          <g key={k}>
            {area && seg.length > 1 && (
              <path d={`${d} L${x(seg[seg.length - 1]!.i).toFixed(1)},${height} L${x(seg[0]!.i).toFixed(1)},${height} Z`} fill={color} fillOpacity={0.12} />
            )}
            {seg.length === 1 ? (
              <circle cx={x(seg[0]!.i)} cy={y(seg[0]!.v)} r={strokeWidth} fill={color} />
            ) : (
              <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            )}
          </g>
        );
      })}
      {showLast && <circle cx={x(lastIdx)} cy={y(lastVal)} r={2.25} fill={color} stroke="var(--color-surface)" strokeWidth={1} />}
    </svg>
  );
}
