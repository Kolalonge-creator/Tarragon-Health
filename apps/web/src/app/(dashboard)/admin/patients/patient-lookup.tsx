"use client";

import { useState, useTransition } from "react";
import { koboToNaira } from "@tarragon/shared";
import { openPatientRecordAction, searchPatientsAction } from "@/lib/admin-patients/actions";
import { paidTotalKobo, reasonOk, queryOk, type PatientRecord, type SearchRow } from "@/lib/admin-patients/model";

/** Every string arrives already translated from the server (packages/i18n, keys adminpatients.*). */
export type LookupLabels = Record<
  | "searchLabel" | "searchHint" | "searchButton" | "none" | "more"
  | "errQuery" | "errReason" | "errNotFound" | "errDenied" | "errFailed"
  | "open" | "test" | "inactive" | "born"
  | "reasonLabel" | "reasonHint" | "reasonConfirm" | "reasonCancel"
  | "recordTitle" | "audited" | "close" | "purchases" | "noPurchases" | "total",
  string
>;

const ERR_KEY = { query: "errQuery", reason: "errReason", not_found: "errNotFound", denied: "errDenied", failed: "errFailed" } as const;
const button = "rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "-");

export function PatientLookup({ labels }: { labels: LookupLabels }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [error, setError] = useState<keyof typeof ERR_KEY | null>(null);
  const [opening, setOpening] = useState<SearchRow | null>(null);
  const [reason, setReason] = useState("");
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [pending, start] = useTransition();

  function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRecord(null);
    setOpening(null);
    start(async () => {
      const r = await searchPatientsAction(query);
      if (r.ok) setRows(r.rows);
      else {
        setRows(null);
        setError(r.error);
      }
    });
  }

  function confirmOpen(e: React.FormEvent) {
    e.preventDefault();
    if (!opening) return;
    setError(null);
    start(async () => {
      const r = await openPatientRecordAction(opening.patient_id, reason);
      if (r.ok) {
        setRecord(r.record);
        setOpening(null);
        setReason("");
      } else setError(r.error);
    });
  }

  function closeRecord() {
    // The record is held only in this screen; closing drops it, so a second look is a second reason and a second audit row.
    setRecord(null);
    setRows(null);
    setQuery("");
  }

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="max-w-xl space-y-2">
        <label className="block text-sm font-medium text-charcoal-ink" htmlFor="patient-q">{labels.searchLabel}</label>
        <div className="flex gap-2">
          <input id="patient-q" className={field} value={query} onChange={(e) => setQuery(e.target.value)} maxLength={80} autoComplete="off" />
          <button type="submit" disabled={pending || !queryOk(query)} className={`${button} bg-brand-green text-white`}>{labels.searchButton}</button>
        </div>
        <p className="text-xs text-charcoal-ink/60">{labels.searchHint}</p>
      </form>

      {error && <p role="alert" className="max-w-xl rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{labels[ERR_KEY[error]]}</p>}

      {rows && rows.length === 0 && <p className="text-sm text-charcoal-ink/70">{labels.none}</p>}
      {rows && rows.length > 0 && !record && (
        <ul className="max-w-2xl divide-y divide-charcoal-ink/10 rounded-xl border border-charcoal-ink/10 bg-white dark:border-night-ink/20">
          {rows.map((r) => (
            <li key={r.patient_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div>
                <p className="font-medium text-charcoal-ink">
                  {r.full_name ?? "-"} <span className="font-normal text-charcoal-ink/60">{r.patient_number ?? ""}</span>
                  {r.is_test && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{labels.test}</span>}
                  {!r.is_active && <span className="ml-2 rounded bg-charcoal-ink/10 px-1.5 py-0.5 text-xs">{labels.inactive}</span>}
                </p>
                <p className="text-charcoal-ink/60">{r.phone_masked ?? "-"}{r.birth_year ? ` · ${labels.born} ${r.birth_year}` : ""}</p>
              </div>
              <button type="button" onClick={() => { setOpening(r); setReason(""); setError(null); }} className={`${button} border border-charcoal-ink/20 text-charcoal-ink`}>{labels.open}</button>
            </li>
          ))}
          {rows.length >= 25 && <li className="p-3 text-xs text-charcoal-ink/60">{labels.more}</li>}
        </ul>
      )}

      {opening && (
        <form onSubmit={confirmOpen} className="max-w-xl space-y-2 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
          <p className="text-sm font-semibold text-charcoal-ink">{opening.full_name} {opening.patient_number ?? ""}</p>
          <label className="block text-sm font-medium text-charcoal-ink" htmlFor="patient-reason">{labels.reasonLabel}</label>
          <textarea id="patient-reason" className={field} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <p className="text-xs text-charcoal-ink/60">{labels.reasonHint}</p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !reasonOk(reason)} className={`${button} bg-brand-green text-white`}>{labels.reasonConfirm}</button>
            <button type="button" onClick={() => setOpening(null)} className={`${button} border border-charcoal-ink/20`}>{labels.reasonCancel}</button>
          </div>
        </form>
      )}

      {record && (
        <section aria-label={labels.recordTitle} className="max-w-2xl space-y-3 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">{record.full_name ?? "-"} <span className="text-sm font-normal text-charcoal-ink/60">{record.patient_number ?? ""}</span></h2>
            <button type="button" onClick={closeRecord} className={`${button} border border-charcoal-ink/20`}>{labels.close}</button>
          </div>
          <p role="status" className="text-xs text-emerald-800">{labels.audited}</p>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {[
              ["Email", record.email], ["Phone", record.phone], ["Date of birth", day(record.date_of_birth)], ["Sex", record.sex],
              ["City", [record.city, record.state].filter(Boolean).join(", ") || null], ["Organisation", record.organisation_name],
              ["Joined", day(record.created_at)], ["Last active", day(record.last_active_at)],
            ].map(([k, v]) => (
              <div key={k as string} className="flex gap-2"><dt className="w-28 shrink-0 text-charcoal-ink/60">{k}</dt><dd className="text-charcoal-ink">{v ?? "-"}</dd></div>
            ))}
          </dl>
          <h3 className="pt-2 text-sm font-semibold text-charcoal-ink">{labels.purchases} · {labels.total} {naira(paidTotalKobo(record.purchases))}</h3>
          {record.purchases.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">{labels.noPurchases}</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {record.purchases.map((p, i) => (
                <li key={i} className="flex justify-between gap-3 py-1.5"><span>{p.label} <span className="text-charcoal-ink/60">({p.status}, {day(p.purchased_at)})</span></span><span>{naira(p.amount_kobo)}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
