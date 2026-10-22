import { t } from "@tarragon/i18n";
import type { BiomarkerBand } from "@tarragon/shared";
import { rangeBarModel, type BiomarkerGrade } from "@/lib/biomarkers/grade";

const SEGMENT_CLASS: Record<BiomarkerGrade, string> = {
  good: "bg-green-400/80 dark:bg-green-500/70",
  acceptable: "bg-amber-300/90 dark:bg-amber-400/70",
  needs_attention: "bg-rose-400/80 dark:bg-rose-400/70",
};

/**
 * The coloured bar under a result: green where Tarragon's band says good, amber either side of it, rose beyond. A small marker shows
 * where this result sits. Colour is never the only signal: the grade chip and the sentence in `label` say the same thing in words.
 */
export function RangeBar({ value, band, label }: { value: number; band: BiomarkerBand; label: string }) {
  const m = rangeBarModel(value, band);
  return (
    <div role="img" aria-label={label} className="relative h-6 w-full">
      <div className="absolute inset-x-0 top-2.5 flex h-2 overflow-hidden rounded-full">
        {m.segments.map((s, i) => (
          <div key={i} className={SEGMENT_CLASS[s.grade]} style={{ width: `${s.to - s.from}%` }} />
        ))}
      </div>
      <div className="absolute top-0 -translate-x-1/2" style={{ left: `${m.marker}%` }} aria-hidden>
        <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-charcoal-ink dark:border-t-night-ink" />
        <div className="mx-auto h-4 w-0.5 bg-charcoal-ink dark:bg-night-ink" />
      </div>
    </div>
  );
}

export function rangeBarLabel(grade: BiomarkerGrade, uiLanguage: Parameters<typeof t>[1]): string {
  return t(`biomarkers.bar.${grade}` as Parameters<typeof t>[0], uiLanguage);
}
