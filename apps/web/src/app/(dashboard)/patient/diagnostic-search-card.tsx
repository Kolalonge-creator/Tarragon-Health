"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE, getProposedConfig } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { findPlacesForPatientAction, findTestsAction, type FindTests, type TestMatch } from "@/lib/diagnostic-directory/patient-search";
import type { SearchResult, SearchRow } from "@/lib/diagnostic-directory/search";

const locale = DEFAULT_UI_LANGUAGE;
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25 dark:bg-night-card dark:text-night-ink";
const CFG = getProposedConfig<{ radii_km: number[]; default_radius_km: number }>("directory.diagnostic_search").value;

/**
 * Diagnostic directory Phase 6: a patient finds a branch that does one exact test. Step 1 picks the test (ambiguous words
 * like "scan" are clarified, never guessed). Step 2 searches by the browser's location and a radius, or by state and LGA.
 * Ranking, eligibility, the partner band and labelling all come from the database.
 */
export function DiagnosticSearchCard({ defaultState, defaultLga }: { defaultState: string | null; defaultLga: string | null }) {
  const [text, setText] = useState("");
  const [tests, setTests] = useState<FindTests | null>(null);
  const [test, setTest] = useState<TestMatch | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<"idle" | "busy" | "denied">("idle");
  const [radius, setRadius] = useState(CFG.default_radius_km);
  const [state, setState] = useState(defaultState ?? "");
  const [lga, setLga] = useState(defaultLga ?? "");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [page, setPage] = useState(0);
  const [pending, start] = useTransition();

  const searchTest = () => start(async () => { setTest(null); setResult(null); setTests(await findTestsAction(text)); });
  const locate = () => {
    if (!("geolocation" in navigator)) return setLocating("denied");
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating("idle"); },
      () => setLocating("denied"),
      { maximumAge: 300000, timeout: 10000 },
    );
  };
  const searchPlaces = (nextPage = 0) => {
    if (!test) return;
    start(async () => {
      const where = point ? { ...point, radiusKm: radius } : { state, lga };
      const r = await findPlacesForPatientAction({ conceptId: test.concept_id, where, page: nextPage });
      setPage(nextPage);
      setResult((prev) => (nextPage > 0 && prev?.ok && r.ok ? { ...r, rows: [...prev.rows, ...r.rows], total: r.total ?? prev.total } : r));
    });
  };

  return (
    <Card>
      <CardHeader><CardTitle>{t("dxsearch.find.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("dxsearch.find.intro", locale)}</p>

        <form onSubmit={(e) => { e.preventDefault(); searchTest(); }} className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[14rem] flex-1 text-sm text-charcoal-ink dark:text-night-ink">{t("dxsearch.find.test", locale)}
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("dxsearch.find.test_placeholder", locale)} className={field} />
          </label>
          <button type="submit" disabled={pending || text.trim().length < 2} className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {t("dxsearch.find.search_test", locale)}
          </button>
        </form>

        {tests && !tests.ok && <p role="alert" className="text-sm text-amber-900">{t("dxsearch.find.error", locale)}</p>}
        {tests && tests.ok && tests.matches.length === 0 && <p className="text-sm text-charcoal-ink/70">{t("dxsearch.find.no_test", locale)}</p>}
        {tests && tests.ok && tests.matches.length > 0 && !test && (
          <fieldset className="space-y-1">
            {tests.clarifying && <legend className="text-sm text-charcoal-ink">{t("dxsearch.find.which_one", locale, { group: tests.clarifying })}</legend>}
            <div className="flex flex-wrap gap-2">
              {tests.matches.map((m) => (
                <button key={m.concept_id} type="button" onClick={() => { setTest(m); setResult(null); }}
                  className="rounded-full border border-brand-green px-3 py-1 text-sm text-brand-green hover:bg-brand-green/10">
                  {m.display}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {test && (
          <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
            <p className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{test.display}</p>
            {test.patient_description && <p className="text-xs text-charcoal-ink/70">{test.patient_description}</p>}
            <p className="text-sm text-charcoal-ink dark:text-night-ink">{t("dxsearch.find.where", locale)}</p>
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" onClick={locate} className="rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm font-semibold text-charcoal-ink dark:text-night-ink">
                {locating === "busy" ? t("dxsearch.find.locating", locale) : t("dxsearch.find.use_location", locale)}
              </button>
              {point && (
                <label className="block text-sm text-charcoal-ink dark:text-night-ink">{t("dxsearch.find.radius", locale)}
                  <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className={field}>
                    {CFG.radii_km.map((km) => <option key={km} value={km}>{t("dxsearch.find.km", locale, { km })}</option>)}
                  </select>
                </label>
              )}
            </div>
            {locating === "denied" && <p className="text-xs text-amber-900">{t("dxsearch.find.location_denied", locale)}</p>}
            {!point && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm text-charcoal-ink dark:text-night-ink">{t("dxsearch.find.state", locale)}
                  <input value={state} onChange={(e) => setState(e.target.value)} className={field} />
                </label>
                <label className="block text-sm text-charcoal-ink dark:text-night-ink">{t("dxsearch.find.lga", locale)}
                  <input value={lga} onChange={(e) => setLga(e.target.value)} className={field} />
                </label>
              </div>
            )}
            <button type="button" disabled={pending || (!point && state.trim().length < 2)} onClick={() => searchPlaces(0)}
              className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {t("dxsearch.find.search_places", locale)}
            </button>
          </div>
        )}

        {result && <Results result={result} test={test} pending={pending} onMore={() => searchPlaces(page + 1)} />}
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("dxsearch.verified.explainer", locale)}</p>
      </CardContent>
    </Card>
  );
}

function Results({ result, test, pending, onMore }: { result: SearchResult; test: TestMatch | null; pending: boolean; onMore: () => void }) {
  if (!result.ok) {
    return <p role="alert" className="text-sm text-amber-900">{t(result.reason === "closed" ? "dxsearch.find.closed" : "dxsearch.find.error", locale)}</p>;
  }
  if (result.rows.length === 0) return <p className="text-sm text-charcoal-ink/70">{t("dxsearch.find.none", locale)}</p>;
  const recommended = result.rows.filter((r) => r.result_group !== "unconfirmed");
  const unconfirmed = result.rows.filter((r) => r.result_group === "unconfirmed");
  const hasPartner = result.rows.some((r) => r.is_partner);
  return (
    <section aria-live="polite" className="space-y-3">
      {test && <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t("dxsearch.find.for_test", locale, { test: test.display })}</h3>}
      <ul className="space-y-2">{recommended.map((r) => <Row key={r.service_id} r={r} />)}</ul>
      {unconfirmed.length > 0 && (
        <>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">{t("dxsearch.find.unconfirmed_group", locale)}</h4>
          <ul className="space-y-2">{unconfirmed.map((r) => <Row key={r.service_id} r={r} />)}</ul>
        </>
      )}
      {hasPartner && (
        <details className="text-xs text-charcoal-ink/70">
          <summary className="cursor-pointer font-semibold">{t("dxsearch.partner.explainer_title", locale)}</summary>
          <p className="mt-1">{t("dxsearch.partner.explainer", locale)}</p>
        </details>
      )}
      {result.total !== null && result.rows.length < result.total && (
        <button type="button" disabled={pending} onClick={onMore} className="text-sm font-semibold text-brand-green hover:underline">{t("dxsearch.find.more", locale)}</button>
      )}
    </section>
  );
}

function Row({ r }: { r: SearchRow }) {
  return (
    <li className="rounded-lg border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15">
      <p className="font-semibold text-charcoal-ink dark:text-night-ink">
        {r.provider_name}: {r.branch_name}
        {r.is_partner && (
          // Never styled like a verification or accreditation mark (DIR-1): a plain outlined label.
          <span className="ml-2 rounded-full border border-charcoal-ink/30 px-2 py-0.5 text-xs font-semibold text-charcoal-ink/80">{t("dxsearch.partner.badge", locale)}</span>
        )}
      </p>
      <p className="text-charcoal-ink/70 dark:text-night-ink/70">{[r.address, r.neighbourhood, r.town, r.lga, r.state].filter(Boolean).join(", ")}</p>
      {r.distance_km !== null && <p className="text-xs text-charcoal-ink/60">{t("dxsearch.find.distance", locale, { km: r.distance_km })}</p>}
      {r.result_group === "unconfirmed" && <p className="text-xs font-semibold text-amber-900">{t("dxsearch.find.unconfirmed", locale)}</p>}
      {(r.appointment_required || r.availability === "by_appointment") && <p className="text-xs text-charcoal-ink/70">{t("dxsearch.find.by_appointment", locale)}</p>}
      {r.performed_elsewhere && <p className="text-xs text-charcoal-ink/70">{t("dxsearch.find.sent_elsewhere", locale)}</p>}
      {r.preparation_note && <p className="text-xs text-charcoal-ink/70">{t("dxsearch.place.prep", locale, { note: r.preparation_note })}</p>}
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        <a className="font-semibold text-brand-green hover:underline" href={`tel:${r.phone}`}>{r.phone}</a>
        <a className="font-semibold text-brand-green hover:underline" target="_blank" rel="noopener noreferrer"
          href={`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`}>{t("dxsearch.place.directions", locale)}</a>
        <Link className="font-semibold text-brand-green hover:underline" href={`/patient/labs/branch/${r.branch_listing_id}`}>{t("dxsearch.find.details", locale)}</Link>
      </div>
    </li>
  );
}
