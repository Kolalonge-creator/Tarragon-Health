"use client";

import { useRef, useState, useTransition } from "react";
import { loadDirectoryAction } from "@/lib/admin-patient-directory/actions";
import {
  PAGE_SIZE, REASON_MAX, SEGMENTS, SEGMENT_LABEL, actionLabel, formatDuration, planLabel, reasonOk, sectionLabel, statusLabel, topList,
  type DirectoryPage, type DirectoryRow, type Segment, type SortKey,
} from "@/lib/admin-patient-directory/model";
import { koboToNaira } from "@tarragon/shared";

const button = "rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "-";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

const COUNT_KEY: Record<Segment, keyof DirectoryPage["summary"]> = {
  all: "total", active: "active", dormant: "dormant", never: "never", members: "members", free: "free", new_30d: "new_30d", inactive: "inactive",
};
const COLUMNS: { label: string; sort?: SortKey }[] = [
  { label: "Patient", sort: "name" },
  { label: "Plan" },
  { label: "Joined", sort: "joined" },
  { label: "Last sign-in", sort: "last_login" },
  { label: "Last activity", sort: "last_active" },
  { label: "Visits", sort: "visits" },
  { label: "Est. time on platform", sort: "time_spent" },
  { label: "Does most" },
  { label: "Paid", sort: "paid" },
];

export function DirectoryTable({ initial }: { initial: DirectoryPage }) {
  const [data, setData] = useState(initial);
  const [segment, setSegment] = useState<Segment>("all");
  const [sort, setSort] = useState<SortKey>("joined");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  // Responses can arrive out of order; only the newest request may update the screen.
  const latest = useRef(0);

  function load(next: { segment?: Segment; sort?: SortKey; dir?: "asc" | "desc"; page?: number; search?: string }) {
    const q = { segment, sort, dir, page, search: applied, ...next };
    const mine = ++latest.current;
    start(async () => {
      const r = await loadDirectoryAction(q);
      if (mine !== latest.current) return;
      if (r.ok) {
        setFailed(false);
        setData(r.page);
        setSegment(q.segment);
        setSort(q.sort);
        setDir(q.dir);
        setPage(q.page);
        setApplied(q.search);
      } else setFailed(true);
    });
  }

  function toggleSort(key: SortKey) {
    load(key === sort ? { dir: dir === "desc" ? "asc" : "desc", page: 0 } : { sort: key, dir: key === "name" ? "asc" : "desc", page: 0 });
  }

  const s = data.summary;
  const pages = Math.max(1, Math.ceil(data.matching / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Patients", value: s.total, hint: `${s.account_active} with the account switched on` },
          { label: "Used it in 30 days", value: s.active, hint: `${s.dormant} dormant, ${s.never} never active` },
          { label: "Members", value: s.members, hint: `${s.free} on Free` },
          { label: "Joined in 30 days", value: s.new_30d, hint: "New sign-ups" },
          { label: "Avg time on platform", value: formatDuration(s.avg_time_spent_seconds), hint: "Per patient who has visited. An estimate." },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-charcoal-ink/10 bg-white p-4">
            <p className="text-xs text-charcoal-ink/60">{t.label}</p>
            <p className="font-heading text-2xl font-semibold text-charcoal-ink">{t.value}</p>
            <p className="mt-0.5 text-xs text-charcoal-ink/60">{t.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            load({ search: search.trim(), page: 0 });
          }}
        >
          <div>
            <label htmlFor="dir-q" className="block text-sm font-medium text-charcoal-ink">Search</label>
            <input id="dir-q" className={`${field} w-72`} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} autoComplete="off" placeholder="Name, patient number, city or state" />
          </div>
          <button type="submit" disabled={pending} className={`${button} mt-6 bg-brand-green text-white`}>Search</button>
        </form>
        <button type="button" onClick={() => setExporting((v) => !v)} className={`${button} ml-auto border border-brand-green text-brand-green`}>
          Download Excel
        </button>
      </div>

      {exporting && (
        <form method="post" action="/admin/patients/directory/export" className="max-w-2xl space-y-2 rounded-xl border border-charcoal-ink/15 bg-white p-4">
          <label htmlFor="dir-reason" className="block text-sm font-medium text-charcoal-ink">Why are you downloading this list?</label>
          <textarea id="dir-reason" name="reason" className={field} rows={2} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-charcoal-ink/60">
            For example: monthly engagement review with the operations lead. This is saved with your name and the time. The file holds the
            {" "}{data.matching} {data.matching === 1 ? "patient" : "patients"} in the current view ({SEGMENT_LABEL[segment]}{applied ? ", with your search" : ""}), in the order you are looking at,
            with masked phone numbers and no clinical data. Keep it on company devices.
          </p>
          <input type="hidden" name="segment" value={segment} />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="search" value={applied} />
          <button type="submit" disabled={!reasonOk(reason)} className={`${button} bg-brand-green text-white`}>Record my reason and download</button>
        </form>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter patients">
        {SEGMENTS.map((seg) => (
          <button
            key={seg}
            type="button"
            aria-pressed={segment === seg}
            disabled={pending}
            onClick={() => load({ segment: seg, page: 0 })}
            className={`rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
              segment === seg ? "border-brand-green bg-brand-green text-white" : "border-charcoal-ink/20 bg-white text-charcoal-ink"
            }`}
          >
            {SEGMENT_LABEL[seg]} <span className="opacity-70">({s[COUNT_KEY[seg]] as number})</span>
          </button>
        ))}
      </div>

      {failed && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">That did not load. What is shown is the previous view. Please try again.</p>}

      <div className={`overflow-x-auto rounded-xl border border-charcoal-ink/10 bg-white ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
        <table className="min-w-full text-left text-sm">
          <thead className="bg-charcoal-ink/5 text-xs uppercase tracking-wide text-charcoal-ink/70">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold" aria-sort={c.sort && c.sort === sort ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <button type="button" onClick={() => toggleSort(c.sort as SortKey)} className="uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
                      {c.label} {c.sort === sort ? (dir === "asc" ? "↑" : "↓") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-ink/10">
            {data.rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-charcoal-ink/60">No patient matches this view.</td></tr>
            )}
            {data.rows.map((r) => <Row key={r.patient_id} r={r} />)}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-charcoal-ink/70">
        <p>{data.matching} in this view. Page {page + 1} of {pages}.</p>
        <div className="flex gap-2">
          <button type="button" className={`${button} border border-charcoal-ink/20`} disabled={pending || page === 0} onClick={() => load({ page: page - 1 })}>Previous</button>
          <button type="button" className={`${button} border border-charcoal-ink/20`} disabled={pending || page + 1 >= pages} onClick={() => load({ page: page + 1 })}>Next</button>
        </div>
      </div>

      <details className="max-w-3xl text-xs text-charcoal-ink/65">
        <summary className="cursor-pointer font-medium">How these figures are worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Last activity</strong> is the latest of the app heartbeat, a page view, or a real action such as logging a reading or messaging the care team.</li>
          <li><strong>Visit</strong> is a run of page views with no gap over 30 minutes. <strong>Time on platform</strong> adds up the span of each visit. It is an estimate and a minimum: the last page of a visit has no known time, a visit with one page counts as zero, and the mobile app and anyone sending Do-Not-Track record no page views.</li>
          <li><strong>Does most</strong> lists the three most frequent real actions, then the most visited sections of the website.</li>
          <li><strong>Used it in 30 days</strong> is not the same as the dashboard&apos;s account-active count, which only says the account is switched on.</li>
        </ul>
      </details>
    </div>
  );
}

function Row({ r }: { r: DirectoryRow }) {
  const places = [r.city, r.state].filter(Boolean).join(", ");
  const meta = [r.age_band, r.sex, places, r.account_type === "Dependent" ? "Dependent account" : null].filter(Boolean).join(" · ");
  const does = [topList(r.top_actions, actionLabel), r.top_sections.length ? `Pages: ${topList(r.top_sections, sectionLabel)}` : ""].filter(Boolean).join(" | ");
  return (
    <tr className="align-top">
      <td className="min-w-48 px-3 py-2">
        <p className="font-medium text-charcoal-ink">{r.full_name ?? "No name"} {!r.is_active && <span className="ml-1 rounded bg-red-100 px-1.5 text-xs text-red-800">Switched off</span>}</p>
        <p className="text-xs text-charcoal-ink/60">{r.patient_number ?? "-"} · {r.phone_masked ?? "no phone"}</p>
        {meta && <p className="text-xs text-charcoal-ink/60">{meta}</p>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {planLabel(r)}
        {r.membership_ends_at && r.plan !== "free" && <p className="text-xs text-charcoal-ink/60">to {day(r.membership_ends_at)}{r.auto_renew ? " · renews automatically" : ""}</p>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{day(r.joined_at)}</td>
      <td className="whitespace-nowrap px-3 py-2">{when(r.last_login_at)}<p className="text-xs text-charcoal-ink/60">{r.login_count} sign-ins</p></td>
      <td className="whitespace-nowrap px-3 py-2">{when(r.last_active_at)}<p className="text-xs text-charcoal-ink/60">{statusLabel(r.activity_status)}</p></td>
      <td className="whitespace-nowrap px-3 py-2">{r.visits_total}<p className="text-xs text-charcoal-ink/60">{r.visits_30d} in 30 days · {r.active_days_30d} active days</p></td>
      <td className="whitespace-nowrap px-3 py-2">{formatDuration(r.time_spent_seconds)}<p className="text-xs text-charcoal-ink/60">{r.visits_total ? `${formatDuration(r.avg_visit_seconds)} a visit` : "no page views"}{r.main_device ? ` · ${r.main_device}` : ""}</p></td>
      <td className="min-w-56 px-3 py-2 text-xs text-charcoal-ink/80">{does || "-"}<p className="text-charcoal-ink/60">{r.actions_total} actions · last {day(r.last_action_at)}</p></td>
      <td className="whitespace-nowrap px-3 py-2">{naira(r.paid_total_kobo)}<p className="text-xs text-charcoal-ink/60">{r.purchases_count} paid {r.purchases_count === 1 ? "purchase" : "purchases"}</p></td>
    </tr>
  );
}
