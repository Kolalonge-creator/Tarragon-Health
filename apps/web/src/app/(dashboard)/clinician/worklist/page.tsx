import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { getTestPatientIdsForRequest } from "@/lib/queries/real-patients-request";
import { formatPatientTime } from "@/lib/format-date";
import { loadDoctorWorklist } from "@/lib/worklist/doctor-worklist-load";
import { WORKLIST_TITLES } from "@/lib/security/worklists";
import {
  countByPriority,
  filterWorklist,
  parseWorklistFilter,
  sortWorklist,
  WORKLIST_PRIORITY_LABEL,
  WORKLIST_SOURCE_LABEL,
  type WorklistPriority,
} from "@tarragon/shared";
import { WorklistTable } from "./worklist-table";

export const metadata = { title: "My worklist" };

/** Rows drawn per page view; narrowing with the filters reaches the rest. Keeps the page light on slow links. */
const MAX_ROWS = 200;
const PRIORITY_ORDER: WorklistPriority[] = ["critical", "urgent", "priority", "not_graded", "routine"];

/**
 * The doctor's unified worklist (doctor workspace spec 8.4 and 9, founder decision DW-01): every open escalation,
 * clinical alert and shared review item, named, in one list, most urgent first. Server-rendered with a plain GET
 * form so it works on a slow connection (S35). Taking work is unchanged: rows link to the screens that act on it.
 */
export default async function DoctorWorklistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseWorklistFilter(await searchParams);
  const [profile, staff, supabase, testPatientIds] = await Promise.all([
    getCurrentProfile(),
    getCurrentClinicalStaff(),
    createClient(),
    getTestPatientIdsForRequest(),
  ]);
  const now = new Date();
  const load = await loadDoctorWorklist(supabase, { profileId: profile?.id ?? null, staffId: staff?.id ?? null }, testPatientIds);

  const sorted = sortWorklist(load.rows, now);
  const counts = countByPriority(sorted);
  const visible = filterWorklist(sorted, filter);
  const shown = visible.slice(0, MAX_ROWS);
  const failedNames = load.failedSources.map((s) => WORKLIST_SOURCE_LABEL[s].toLowerCase());

  const chipHref = (priority: WorklistPriority | "all") => {
    const p = new URLSearchParams();
    if (priority !== "all") p.set("priority", priority);
    if (filter.source !== "all") p.set("source", filter.source);
    if (filter.assigned !== "all") p.set("assigned", filter.assigned);
    if (filter.q) p.set("q", filter.q);
    const qs = p.toString();
    return qs ? `/clinician/worklist?${qs}` : "/clinician/worklist";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients requiring attention"
        description={`Every open escalation, clinical alert and review item, most urgent first. Updated ${formatPatientTime(now)} (Lagos time); reload to refresh.`}
      />

      {failedNames.length > 0 && (
        <LoadFailure>
          Some work could not be loaded ({failedNames.join(", ")}). This list is incomplete: do not read it as everything
          that is waiting. Reload the page, or open the escalations and review pages directly.
        </LoadFailure>
      )}

      <nav aria-label="Filter by priority" className="flex flex-wrap gap-2 text-sm">
        {(["all", ...PRIORITY_ORDER] as const).map((p) => {
          const active = filter.priority === p;
          const label = p === "all" ? `All (${sorted.length})` : `${WORKLIST_PRIORITY_LABEL[p]} (${counts[p]})`;
          return (
            <Link
              key={p}
              href={chipHref(p)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "inline-flex min-h-11 items-center rounded-full bg-deep-forest px-4 font-medium text-white"
                  : "inline-flex min-h-11 items-center rounded-full border border-charcoal-ink/15 px-4 hover:bg-charcoal-ink/5"
              }
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 text-sm">
        {filter.priority !== "all" && <input type="hidden" name="priority" value={filter.priority} />}
        <label className="flex flex-col gap-1">
          <span className="font-medium">Patient name or number</span>
          <input
            type="search"
            name="q"
            defaultValue={filter.q}
            className="min-h-11 rounded-lg border border-charcoal-ink/20 px-3"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Assigned to</span>
          <select name="assigned" defaultValue={filter.assigned} className="min-h-11 rounded-lg border border-charcoal-ink/20 px-3">
            <option value="all">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned or shared</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Type of work</span>
          <select name="source" defaultValue={filter.source} className="min-h-11 rounded-lg border border-charcoal-ink/20 px-3">
            <option value="all">All</option>
            <option value="escalation">{WORKLIST_SOURCE_LABEL.escalation}</option>
            <option value="alert">{WORKLIST_SOURCE_LABEL.alert}</option>
            <option value="queue">{WORKLIST_SOURCE_LABEL.queue}</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-lg bg-brand-green px-4 font-medium text-white hover:bg-deep-forest">
          Apply
        </button>
        <Link href="/clinician/worklist" className="inline-flex min-h-11 items-center px-2 underline">
          Clear
        </Link>
      </form>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-charcoal-ink/70">
          {failedNames.length > 0
            ? "Nothing to show from the work that did load. Part of the list could not be loaded, so this is not an all-clear."
            : sorted.length === 0
              ? "No open escalations, alerts or review items right now."
              : "Nothing matches these filters."}
        </p>
      ) : (
        <WorklistTable rows={shown} now={now} />
      )}

      {visible.length > MAX_ROWS && (
        <p className="text-sm text-charcoal-ink/70">
          Showing the first {MAX_ROWS} of {visible.length}. Narrow the list with the filters above to see the rest.
        </p>
      )}

      {load.queueOverflow.length > 0 && (
        <p className="text-sm text-charcoal-ink/70">
          Some review queues hold more than this list shows (the oldest 100 of each are included):{" "}
          {load.queueOverflow.map((o) => `${WORKLIST_TITLES[o.kind]} (${o.total})`).join("; ")}. See{" "}
          <Link href="/clinician/worklists" className="underline">
            all review queues
          </Link>
          .
        </p>
      )}
    </div>
  );
}
