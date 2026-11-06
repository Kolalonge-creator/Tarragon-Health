import { formatGlucose, GLUCOSE_UNIT_LABEL, homePinVitalDisplay, type GlucoseDisplayUnit, type MeasurementUnits } from "@tarragon/shared";
import { BigNumberTile } from "@/app/(dashboard)/patient/home/big-number-tile";
import { HOME_PIN_ICON } from "@/lib/patient/home-pin-targets";
import { getPinSeries, type PinSeries } from "@/lib/patient/home-pin-series";
import { trendWord, whenLabel } from "@/lib/patient/trend-word";

function detail(series: PinSeries, nowMs: number): string | null {
  if (series.latestAt === null) return null;
  return [whenLabel(series.latestAt, nowMs), trendWord(series.points, nowMs)].filter(Boolean).join(" · ");
}

/**
 * Vitals opens with the latest readings as big numbers (founder, 2026-11-06, chosen in a prompt). Blood pressure keeps its own
 * larger hero above this row (status word and 7-day average, LatestBpHero); this row adds blood sugar, weight and pulse,
 * each with when it was taken, which way it has moved this month in words, and a 30-day trend line. A failed read says so.
 */
/** Data + date work lives outside the component body (react-hooks/purity). */
async function loadRow(patientId: string) {
  const nowMs = Date.now();
  return { nowMs, series: await getPinSeries(patientId, ["glucose", "weight", "pulse"], nowMs) };
}

export async function LatestReadingsRow({
  patientId,
  glucoseUnit,
  units,
}: {
  patientId: string;
  glucoseUnit: GlucoseDisplayUnit;
  units: MeasurementUnits;
}) {
  const { nowMs, series } = await loadRow(patientId);

  const tile = (key: "glucose" | "weight" | "pulse", label: string) => {
    const s = series[key];
    if (s === "failed") return <BigNumberTile icon={HOME_PIN_ICON[key]} label={label} empty="Couldn't load just now" />;
    const shown =
      !s || s.latestValue === null
        ? null
        : key === "glucose"
          ? { value: formatGlucose(s.latestValue, glucoseUnit, { withUnit: false }) ?? "", unit: GLUCOSE_UNIT_LABEL[glucoseUnit] }
          : homePinVitalDisplay(key, s.latestValue, units);
    return (
      <BigNumberTile
        icon={HOME_PIN_ICON[key]}
        label={label}
        {...(shown?.value ? { value: shown.value, unit: shown.unit } : { empty: "No reading yet" })}
        detail={s ? detail(s, nowMs) : null}
        points={s ? s.points : undefined}
      />
    );
  };

  return (
    <section aria-label="Your latest readings" className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
      {tile("glucose", "Blood sugar")}
      {tile("weight", "Weight")}
      {tile("pulse", "Pulse")}
    </section>
  );
}
