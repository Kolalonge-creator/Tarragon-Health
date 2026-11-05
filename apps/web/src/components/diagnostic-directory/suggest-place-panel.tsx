"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { formatPatientDate } from "@/lib/format-date";
import { findPlacesAction, suggestPlaceAction, withdrawPlaceAction, type SuggestedPlace } from "@/lib/diagnostic-directory/orders";
import type { SearchRow } from "@/lib/diagnostic-directory/search";

const locale = DEFAULT_UI_LANGUAGE;
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-2 py-1.5 text-sm dark:border-night-ink/25";

/**
 * Clinician: suggest where the patient can have one ordered test done. Searches the PATIENT's state and LGA (design §9),
 * shows only branches that pass every directory check, and records the choice through clinician_suggest_place, which
 * re-checks eligibility. Advice only: it changes nothing on the order.
 */
export function SuggestPlacePanel({ kind, orderId, patientId, patientState, patientLga, tests, current }: {
  kind: "lab" | "imaging";
  orderId: string;
  patientId: string;
  patientState: string | null;
  patientLga: string | null;
  tests: { id: string; display: string }[];
  current: SuggestedPlace | null;
}) {
  const [conceptId, setConceptId] = useState(tests[0]?.id ?? "");
  const [state, setState] = useState(patientState ?? "");
  const [lga, setLga] = useState(patientLga ?? "");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const find = () => start(async () => {
    setMessage(null);
    const res = await findPlacesAction({ patientId, conceptId, state, lga });
    if (res.ok) setRows(res.rows);
    else { setRows(null); setMessage(t(`dxsearch.suggest.error.${res.reason === "closed" ? "closed" : res.reason === "denied" ? "denied" : res.reason === "invalid" ? "invalid" : "failed"}`, locale)); }
  });
  const pick = (branchListingId: string) => start(async () => {
    const res = await suggestPlaceAction({ kind, orderId, patientId, branchListingId, conceptId });
    setMessage(res.ok ? null : t(`dxsearch.suggest.error.${res.reason}`, locale));
    if (res.ok) setRows(null);
  });
  const withdraw = () => start(async () => {
    if (!current) return;
    const res = await withdrawPlaceAction({ suggestionId: current.suggestion_id, patientId, reason });
    setMessage(res.ok ? null : t(`dxsearch.suggest.error.${res.reason}`, locale));
  });

  return (
    <details className="rounded-lg border border-charcoal-ink/10 p-2 text-xs">
      <summary className="cursor-pointer font-semibold text-brand-green">{t("dxsearch.suggest.title", locale)}</summary>
      <div className="mt-2 space-y-2">
        {current ? (
          <div className="space-y-1">
            <p className="text-charcoal-ink">
              {t("dxsearch.suggest.current", locale, {
                branch: current.branch_name, provider: current.provider_name, address: current.address,
                seen: current.viewed_at ? t("dxsearch.suggest.seen", locale, { date: formatPatientDate(current.viewed_at) }) : t("dxsearch.suggest.not_seen", locale),
              })}
            </p>
            {!current.still_recommendable && <p role="alert" className="font-semibold text-amber-900">{t("dxsearch.suggest.stale", locale)}</p>}
            <div className="flex gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("dxsearch.suggest.withdraw_reason", locale)} className={field} />
              <button type="button" disabled={pending || reason.trim().length < 5} onClick={withdraw}
                className="rounded-lg border border-charcoal-ink/20 px-2 py-1 font-semibold text-charcoal-ink disabled:opacity-50">
                {t("dxsearch.suggest.withdraw", locale)}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-charcoal-ink/60">{t("dxsearch.suggest.none", locale)}</p>
        )}
        <p className="text-charcoal-ink/60">{t("dxsearch.suggest.hint", locale)}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">{t("dxsearch.suggest.test", locale)}
            <select value={conceptId} onChange={(e) => setConceptId(e.target.value)} className={field}>
              {tests.map((o) => <option key={o.id} value={o.id}>{o.display}</option>)}
            </select>
          </label>
          <label className="block">{t("dxsearch.suggest.state", locale)}
            <input value={state} onChange={(e) => setState(e.target.value)} className={field} />
          </label>
          <label className="block">{t("dxsearch.suggest.lga", locale)}
            <input value={lga} onChange={(e) => setLga(e.target.value)} className={field} />
          </label>
        </div>
        <button type="button" disabled={pending || !conceptId || state.trim().length < 2} onClick={find}
          className="rounded-lg bg-brand-green px-3 py-1.5 font-semibold text-white disabled:opacity-50">
          {t("dxsearch.suggest.find", locale)}
        </button>
        {message && <p role="alert" className="text-amber-900">{message}</p>}
        {rows && rows.length === 0 && <p className="text-charcoal-ink/70">{t("dxsearch.suggest.found_none", locale)}</p>}
        {rows && rows.length > 0 && (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.service_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-charcoal-ink/10 p-2">
                <span>
                  <span className="font-medium text-charcoal-ink">{r.provider_name}: {r.branch_name}</span>
                  {r.is_partner && <span className="ml-1 rounded-full border border-charcoal-ink/30 px-1.5 text-[10px] font-semibold">{t("dxsearch.partner.badge", locale)}</span>}
                  <span className="block text-charcoal-ink/60">{[r.address, r.town, r.lga].filter(Boolean).join(", ")}</span>
                  {r.credentials_on_file && r.credentials_on_file.length > 0 && <span className="block text-charcoal-ink/50">{r.credentials_on_file.join(", ")}</span>}
                </span>
                <button type="button" disabled={pending} onClick={() => pick(r.branch_listing_id)}
                  className="rounded-lg border border-brand-green px-2 py-1 font-semibold text-brand-green disabled:opacity-50">
                  {t("dxsearch.suggest.pick", locale)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
