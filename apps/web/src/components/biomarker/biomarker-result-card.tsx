import Link from "next/link";
import { t, type MessageKey } from "@tarragon/i18n";
import type { BiomarkerBand } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";
import { displayCode, labRangeLabel, positionInLabRange, type TrendPoint } from "@/lib/biomarkers/trend";
import { isCriticalFlag, type BiomarkerGrade } from "@/lib/biomarkers/grade";
import { RangeBar, rangeBarLabel } from "./range-bar";

type Lang = Parameters<typeof t>[1];

const GRADE_BADGE: Record<BiomarkerGrade, "green" | "amber" | "red"> = { good: "green", acceptable: "amber", needs_attention: "red" };

/** The lab-only chip used while Tarragon's bands are unconfirmed, or for a test with no band. Never invents a grade. */
function labChip(point: TrendPoint): { variant: "green" | "amber" | "red" | "grey"; key: MessageKey } {
  if (isCriticalFlag(point.flag)) return { variant: "red", key: "biomarkers.flag.critical_high" };
  const pos = positionInLabRange(point);
  if (pos === "below" || point.flag === "low") return { variant: "amber", key: "biomarkers.flag.low" };
  if (pos === "above" || point.flag === "high") return { variant: "amber", key: "biomarkers.flag.high" };
  if (pos === "within") return { variant: "green", key: "biomarkers.flag.normal" };
  return { variant: "grey", key: "biomarkers.card.no_range" };
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

/**
 * One result, the way a person reads it: the test name, a status chip, the number, a bar showing where it sits, the laboratory's own
 * range, and (slot) the "help me understand this" explainer. The bar and the Tarragon grade appear only when `grade` and `band` are
 * both given, which the page does only once the CMO has confirmed the bands.
 */
export function BiomarkerResultCard({
  code,
  point,
  grade,
  band,
  selected,
  href,
  uiLanguage,
  children,
}: {
  code: string;
  point: TrendPoint;
  grade: BiomarkerGrade | null;
  band: BiomarkerBand | null;
  selected: boolean;
  href: string;
  uiLanguage: Lang;
  children?: React.ReactNode;
}) {
  const chip = grade
    ? { variant: GRADE_BADGE[grade], text: t(`biomarkers.grade.${grade}` as MessageKey, uiLanguage) }
    : (() => {
        const c = labChip(point);
        return { variant: c.variant, text: t(c.key, uiLanguage) };
      })();
  const range = labRangeLabel(point);
  return (
    <article
      className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-night-card ${
        selected ? "border-brand-green ring-1 ring-brand-green/40" : "border-charcoal-ink/10 dark:border-night-ink/15"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-charcoal-ink dark:text-night-ink">
            <Link href={href} aria-current={selected ? "page" : undefined} className="hover:underline">
              {displayCode(code)}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            <span className="text-lg font-semibold text-charcoal-ink dark:text-night-ink">{point.value}</span>
            {point.unit ? ` ${point.unit}` : ""}
          </p>
        </div>
        <Badge variant={chip.variant}>{chip.text}</Badge>
      </div>

      {grade && band && (
        <div className="mt-3">
          <RangeBar value={point.value} band={band} label={rangeBarLabel(grade, uiLanguage)} />
        </div>
      )}

      <p className="mt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {range ? `${t("biomarkers.col.range", uiLanguage)}: ${range}. ` : ""}
        {t("biomarkers.card.taken", uiLanguage, { date: fmtDate(point.takenAt) })}
        {point.laboratory ? ` · ${point.laboratory}` : ""}
      </p>
      {children ? <div className="mt-3">{children}</div> : null}
    </article>
  );
}
