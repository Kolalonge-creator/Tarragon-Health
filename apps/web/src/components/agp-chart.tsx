import { GLUCOSE_UNIT_LABEL, formatGlucose, glucoseInDisplayUnit, type GlucoseDisplayUnit } from "@tarragon/shared";
import { clockLabel, type AgpBin, type AgpConfig, type AgpResult } from "@/lib/cgm/agp";

/**
 * The 24 hour glucose profile as plain SVG: for each half hour of the day a bar from the lower to the upper percentile of fourteen days of
 * readings, coloured by where it sits against the target lines (above range amber, in range grey, below range red), with the average as a dotted
 * line. Presentational only: it gets a finished result and draws it. Colour is never the only signal, the card around it states the same
 * facts in words and numbers, and the figure has its own title and description for a screen reader.
 */

const W = 640;
const H = 260;
const PAD = { left: 46, right: 20, top: 12, bottom: 30 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const Y_MIN = 2;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** Splits [lo, hi] at the two target lines into the part below, inside and above the range. */
export function splitAtEdges(lo: number, hi: number, low: number, high: number): { zone: "low" | "in" | "high"; from: number; to: number }[] {
  const parts: { zone: "low" | "in" | "high"; from: number; to: number }[] = [];
  const push = (zone: "low" | "in" | "high", from: number, to: number) => {
    if (to > from) parts.push({ zone, from, to });
  };
  push("low", lo, Math.min(hi, low));
  push("in", Math.max(lo, low), Math.min(hi, high));
  push("high", Math.max(lo, high), hi);
  return parts;
}

const ZONE_CLASS = {
  low: "fill-red-400",
  in: "fill-charcoal-ink/25 dark:fill-night-ink/30",
  high: "fill-amber-400",
} as const;

export function AgpChart({ result, unit, config }: { result: AgpResult; unit: GlucoseDisplayUnit; config: AgpConfig }) {
  const { low, high, very_high: veryHigh } = config.band_edges_mmol_l;
  const maxUpper = Math.max(0, ...result.bins.map((b) => b.upper ?? 0));
  const yMax = Math.max(veryHigh + 3, Math.ceil(maxUpper + 1));
  const x = (minute: number) => PAD.left + (minute / 1440) * PLOT_W;
  const y = (mmol: number) => PAD.top + (1 - (Math.min(yMax, Math.max(Y_MIN, mmol)) - Y_MIN) / (yMax - Y_MIN)) * PLOT_H;
  const barW = (PLOT_W * config.bin_minutes) / 1440;
  const ticks = [low, high, veryHigh, ...(yMax >= 20 ? [20] : [])];

  const withData = result.bins.filter((b): b is AgpBin & { lower: number; upper: number } => b.lower !== null && b.upper !== null);
  const meanPath = averagePath(result.bins, x, y, config.bin_minutes);
  const label = unit === "mg_dl" ? "mg/dL" : GLUCOSE_UNIT_LABEL[unit];
  const desc = `Fourteen days of sensor readings by time of day, in ${label}. Target range ${formatGlucose(low, unit)} to ${formatGlucose(high, unit)}.`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="agp-title agp-desc" className="h-auto w-full text-charcoal-ink dark:text-night-ink">
        <title id="agp-title">Glucose profile over a day</title>
        <desc id="agp-desc">{desc}</desc>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === low || t === high ? 0.55 : 0.15} strokeDasharray={t === low || t === high ? undefined : "3 4"} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.7}>
              {glucoseInDisplayUnit(t, unit)}
            </text>
          </g>
        ))}
        <text x={PAD.left - 6} y={PAD.top - 2} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6}>
          {label}
        </text>

        {withData.flatMap((b) =>
          splitAtEdges(b.lower, b.upper, low, high).map((part) => (
            <rect
              key={`${b.startMinute}-${part.zone}`}
              x={x(b.startMinute) + 0.5}
              y={y(part.to)}
              width={Math.max(1, barW - 1)}
              height={Math.max(1, y(part.from) - y(part.to))}
              rx={1.5}
              className={ZONE_CLASS[part.zone]}
            />
          )),
        )}

        {meanPath.map((d) => (
          <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="1 4" />
        ))}

        {HOURS.map((h) => (
          <g key={h}>
            <line x1={x(h * 60)} x2={x(h * 60)} y1={H - PAD.bottom} y2={H - PAD.bottom + 5} stroke="currentColor" strokeOpacity={0.5} />
            <text x={x(h * 60)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.7}>
              {clockLabel(h * 60)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
        <Key className="fill-amber-400" text="Above range" />
        <Key className="fill-charcoal-ink/25 dark:fill-night-ink/30" text="In range" />
        <Key className="fill-red-400" text="Below range" />
        <span>Bars: the middle of the readings ({config.percentiles.lower}th to {config.percentiles.upper}th percentile). Dotted line: average. Lagos time.</span>
      </figcaption>
    </figure>
  );
}

function Key({ className, text }: { className: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={10} height={10} aria-hidden="true">
        <rect width={10} height={10} rx={2} className={className} />
      </svg>
      {text}
    </span>
  );
}

/** The average as one path per unbroken run of half hours, so a time of day with no readings leaves a gap rather than a straight line across it. */
export function averagePath(bins: readonly AgpBin[], x: (m: number) => number, y: (v: number) => number, binMinutes: number): string[] {
  const paths: string[] = [];
  let current = "";
  for (const b of bins) {
    if (b.mean === null) {
      if (current) paths.push(current);
      current = "";
      continue;
    }
    const px = x(b.startMinute + binMinutes / 2).toFixed(1);
    const py = y(b.mean).toFixed(1);
    current += `${current ? "L" : "M"}${px} ${py}`;
  }
  if (current) paths.push(current);
  return paths;
}
