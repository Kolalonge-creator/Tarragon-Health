"use client";

import { useEffect, useMemo, useState } from "react";
import { t } from "@tarragon/i18n";
import {
  ageInMonths,
  bandForPoint,
  buildChildTimeline,
  buildChildVaccineChecklist,
  checklistCounts,
  childCrisisLead,
  crisisToShow,
  cleanCaregiverLabel,
  isAsleepNow,
  latestBand,
  sortByAttention,
  type ChartPointInput,
  type ChildEventKind,
  type ChildFeedType,
} from "@tarragon/shared";
import { useGrowthMeasurements, useLogGrowthMeasurement, type GrowthMeasurementRow } from "@/lib/queries/growth";
import { useChildDailyEvents, useChildVaccineData, useLogChildEvent } from "@/lib/queries/child-log";
import { getChildSwitcher } from "./child-switch";
import { CrisisLead, GrowthBandsView, OneTapButtons, TimelineList, VaccineChecklistView, type GrowthTableRow, type OneTapAction } from "./views";

export interface ChildForPanel {
  id: string;
  firstName: string;
  organisationId: string;
  dateOfBirth: string | null;
  sex: "male" | "female" | null;
  /** manage: may add records. view: a second caregiver who may only look. */
  canLog: boolean;
}

/** Keyed per signed-in account so a shared computer never offers one person's name tag to the next. */
const labelKey = (accountId: string) => `tarragon.childlog.label.v1.${accountId}`;
const lagosToday = (): string => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

function resultOf(r: GrowthMeasurementRow) {
  return bandForPoint({
    weightForAgeZ: r.weight_for_age_z,
    heightForAgeZ: r.height_for_age_z,
    weightForHeightZ: r.weight_for_height_z,
    nutritionClass: r.nutrition_class,
    implausible: r.plausibility_flags.length > 0,
  });
}

const TAPS: { id: string; kind: ChildEventKind; feedType: ChildFeedType | null }[] = [
  { id: "feed_breast", kind: "feed", feedType: "breast" },
  { id: "feed_bottle", kind: "feed", feedType: "bottle" },
  { id: "sleep", kind: "sleep_start", feedType: null },
  { id: "nappy_wet", kind: "nappy_wet", feedType: null },
  { id: "nappy_dirty", kind: "nappy_dirty", feedType: null },
];

/** The whole daily-log page body for one child. Data comes from hooks; every visible piece is a tested presentational view. */
export function ChildLogPanel({ accountId, child, emergencyNumber }: { accountId: string; child: ChildForPanel; emergencyNumber: string }) {
  const events = useChildDailyEvents(child.id);
  const growth = useGrowthMeasurements(child.id);
  const vaccines = useChildVaccineData(child.id);
  const logEvent = useLogChildEvent();
  const logGrowth = useLogGrowthMeasurement();
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");

  useEffect(() => {
    // Read after mount (not during render) so the server and first client render agree.
    void Promise.resolve().then(() => {
      try {
        setLabel(window.localStorage.getItem(labelKey(accountId)) ?? "");
      } catch {
        /* a convenience only */
      }
    });
  }, [accountId]);

  // The child now on screen: a different child than before relocks the mother's section.
  useEffect(() => {
    getChildSwitcher(accountId).show(child.id);
  }, [accountId, child.id]);

  const asleep = isAsleepNow(events.data ?? []);
  const actions: OneTapAction[] = TAPS.map((tap) => ({
    id: tap.id,
    glyph: tap.id === "feed_breast" ? "♥" : tap.id === "feed_bottle" ? "☕" : tap.id === "sleep" ? (asleep ? "☀" : "☾") : tap.id === "nappy_wet" ? "💧" : "●",
    label:
      tap.id === "feed_breast" ? t("cdl.log.feed_breast")
      : tap.id === "feed_bottle" ? t("cdl.log.feed_bottle")
      : tap.id === "sleep" ? (asleep ? t("cdl.log.sleep_stop") : t("cdl.log.sleep_start"))
      : tap.id === "nappy_wet" ? t("cdl.log.nappy_wet")
      : t("cdl.log.nappy_dirty"),
  }));

  async function onTap(id: string) {
    const tap = TAPS.find((x) => x.id === id);
    if (!tap || !child.canLog) return;
    const kind: ChildEventKind = tap.id === "sleep" ? (asleep ? "sleep_stop" : "sleep_start") : tap.kind;
    try {
      window.localStorage.setItem(labelKey(accountId), cleanCaregiverLabel(label) ?? "");
    } catch {
      /* a convenience only */
    }
    const result = await logEvent.mutateAsync({ childId: child.id, organisationId: child.organisationId, kind, feedType: tap.feedType, loggedBy: label }).catch(() => "failed" as const);
    setStatus(result === "saved" ? t("cdl.log.saved") : result === "not_open" ? t("cdl.log.not_open") : t("cdl.log.failed"));
  }

  const growthRows = useMemo<GrowthTableRow[]>(
    () => (growth.data ?? []).map((r) => ({ id: r.id, measuredAt: r.measured_at, weightKg: r.weight_kg, heightCm: r.height_cm, result: resultOf(r) })),
    [growth.data],
  );
  const points = (pick: (r: GrowthMeasurementRow) => number | null): ChartPointInput[] =>
    (growth.data ?? []).flatMap((r) => {
      const v = pick(r);
      if (v === null || !child.dateOfBirth) return [];
      const res = resultOf(r);
      return [{ id: r.id, ageMonths: ageInMonths(child.dateOfBirth, r.measured_at), value: v, band: res.kind === "band" ? res.band : null }];
    });

  const timeline = useMemo(() => {
    const names = new Map((vaccines.data?.catalog ?? []).map((c) => [c.id, c.name]));
    return buildChildTimeline({
      events: events.data ?? [],
      growth: growthRows.map((g) => ({ id: g.id, measuredAt: g.measuredAt, weightKg: g.weightKg, heightCm: g.heightCm })),
      vaccines: (vaccines.data?.records ?? []).map((r) => ({
        id: r.id, name: names.get(r.vaccination_catalog_id) ?? "", doseNumber: r.dose_number, dateAdministered: r.date_administered, verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt,
      })),
    });
  }, [events.data, growthRows, vaccines.data]);

  const doses = useMemo(
    () =>
      vaccines.data && child.dateOfBirth
        ? sortByAttention(buildChildVaccineChecklist({ dateOfBirth: child.dateOfBirth, sex: child.sex, today: lagosToday(), catalog: vaccines.data.catalog, records: vaccines.data.records }))
        : [],
    [vaccines.data, child.dateOfBirth, child.sex],
  );
  const counts = checklistCounts(doses);
  const latestResult = useMemo(
    () =>
      latestBand(
        (growth.data ?? []).map((r) => ({
          weightForAgeZ: r.weight_for_age_z, heightForAgeZ: r.height_for_age_z, weightForHeightZ: r.weight_for_height_z,
          nutritionClass: r.nutrition_class, implausible: r.plausibility_flags.length > 0, measuredAt: r.measured_at, muacMm: r.muac_mm, bilateralOedema: r.bilateral_oedema === true,
        })),
      ),
    [growth.data],
  );
  const computedCrisis = childCrisisLead(latestResult);
  // A known crisis is never hidden by a failed or slow read: a successful read decides and is remembered; otherwise the last known state shows.
  const crisisKey = `tarragon.childlog.crisis.v1.${accountId}.${child.id}`;
  const [lastKnown, setLastKnown] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        setLastKnown(window.localStorage.getItem(crisisKey) === "1");
      } catch {
        /* nothing known */
      }
    });
  }, [crisisKey]);
  const readOk = growth.isSuccess;
  useEffect(() => {
    if (!readOk) return;
    try {
      window.localStorage.setItem(crisisKey, computedCrisis ? "1" : "0");
    } catch {
      /* a convenience only */
    }
  }, [readOk, computedCrisis, crisisKey]);
  const crisis = crisisToShow(readOk, computedCrisis, lastKnown);

  async function saveGrowth(e: React.FormEvent) {
    e.preventDefault();
    const w = weight.trim() === "" ? null : Number(weight);
    const h = height.trim() === "" ? null : Number(height);
    if ((w === null && h === null) || (w !== null && !Number.isFinite(w)) || (h !== null && !Number.isFinite(h))) return;
    await logGrowth.mutateAsync({ patientId: child.id, organisationId: child.organisationId, weightKg: w, heightCm: h });
    setWeight("");
    setHeight("");
  }

  return (
    <div className="space-y-6">
      {crisis && <CrisisLead emergencyNumber={emergencyNumber} />}
      {!child.canLog && (
        <section aria-labelledby="cdl-partner" className="rounded-xl border p-3">
          <h2 id="cdl-partner" className="font-bold">{t("cdl.partner.title")}</h2>
          <p className="text-sm">{t("cdl.partner.body")}</p>
        </section>
      )}
      <section aria-labelledby="cdl-log" className="space-y-3">
        <h2 id="cdl-log" className="text-lg font-bold">{t("cdl.log.title")}</h2>
        {child.canLog ? (
          <>
            <label className="block text-sm font-semibold" htmlFor="cdl-label">{t("cdl.logged_by.label")}</label>
            <input id="cdl-label" value={label} maxLength={24} placeholder={t("cdl.logged_by.placeholder")} onChange={(e) => setLabel(e.target.value)} className="w-full max-w-sm rounded-lg border px-3 py-2" />
            <p className="text-xs opacity-70">{t("cdl.logged_by.help")}</p>
            <OneTapButtons actions={actions} disabled={logEvent.isPending} status={status} onTap={(id) => void onTap(id)} />
            <p className="text-xs opacity-70">{t("cdl.log.undo_note")}</p>
          </>
        ) : (
          <p className="text-sm">{t("cdl.log.view_only")}</p>
        )}
      </section>
      <section aria-labelledby="cdl-timeline" className="space-y-2">
        <h2 id="cdl-timeline" className="text-lg font-bold">{t("cdl.timeline.title")}</h2>
        {events.isError ? <p role="alert" className="text-sm">{t("cdl.log.failed")}</p> : <TimelineList items={timeline} />}
      </section>
      <section aria-labelledby="cdl-growth" className="space-y-2">
        <h2 id="cdl-growth" className="text-lg font-bold">{t("cdl.growth.title")}</h2>
        {growth.isError && <p role="alert" className="text-sm">{t("cdl.log.failed")}</p>}
        <GrowthBandsView rows={growthRows} latest={latestResult} weightPoints={points((r) => r.weight_kg)} heightPoints={points((r) => r.height_cm)} />
        {child.canLog && (
          <form onSubmit={(e) => void saveGrowth(e)} className="space-y-2">
            <h3 className="font-bold">{t("cdl.growth.log_title")}</h3>
            <label className="block text-sm" htmlFor="cdl-weight">{t("cdl.growth.weight_label")}</label>
            <input id="cdl-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className="rounded-lg border px-3 py-2" />
            <label className="block text-sm" htmlFor="cdl-height">{t("cdl.growth.height_label")}</label>
            <input id="cdl-height" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} className="rounded-lg border px-3 py-2" />
            <button type="submit" className="block rounded-xl bg-brand-green px-4 py-3 font-bold text-white">{t("cdl.growth.save")}</button>
          </form>
        )}
      </section>
      <section aria-labelledby="cdl-vax" className="space-y-2">
        <h2 id="cdl-vax" className="text-lg font-bold">{t("cdl.vax.title")}</h2>
        {vaccines.isError && <p role="alert" className="text-sm">{t("cdl.log.failed")}</p>}
        <VaccineChecklistView doses={doses} counts={counts} />
      </section>
      <section aria-labelledby="cdl-export" className="space-y-1">
        <h2 id="cdl-export" className="text-lg font-bold">{t("cdl.export.title")}</h2>
        <p className="text-sm">{t("cdl.export.help")}</p>
        <a href={`/api/patient/child-record/${child.id}`} className="inline-block rounded-xl border-2 border-brand-green px-4 py-3 font-bold">{t("cdl.export.button")}</a>
      </section>
    </div>
  );
}
