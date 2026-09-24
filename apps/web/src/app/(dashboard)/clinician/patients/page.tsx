import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { ReminderFrequencySelector } from "./reminder-frequency-selector";
import { FILTER_TABS, emptyRosterMessage, type PatientFilter } from "@/lib/patients-directory/empty-roster-message";

/**
 * Org patient directory — the index behind the sidebar "Patients" link.
 * RLS (private.is_org_staff) scopes the query to the caller's organisation;
 * app-code filtering is limited to name search and the filter tabs below —
 * every org-staff account can still see the whole roster (cross-coverage),
 * this only changes what's shown by default.
 *
 * Care Team / Provider Workspace §5.4 asks for "assigned / programme / recent
 * / high-risk / requiring action" lists. "Requiring action" is already the
 * worklist/work-queue surface elsewhere in this app (the /clinician worklist
 * plus the live sidebar count badges, see lib/queries/worklist-counts.ts) —
 * duplicating it as a patient-list filter here would just be a second,
 * easier-to-drift view of the same queue, so it's deliberately not one of
 * the tabs below.
 */
export default async function ClinicianPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    filter?: string;
    mine?: string;
    condition?: string | string[];
  }>;
}) {
  const { q: qParam, filter: filterParam, mine, condition: conditionParam } = await searchParams;
  // Next.js hands back string[] for a repeated query key (?q=a&q=b or
  // ?condition=a&condition=b) — guarded for both search inputs on this page,
  // not just the one this diff adds.
  const q = Array.isArray(qParam) ? qParam[0] : qParam;
  const condition = Array.isArray(conditionParam) ? conditionParam[0] : conditionParam;
  // `mine=1` is the pre-existing link shape (still used by the Monitoring
  // view toggle) — treated as a synonym for filter=mine rather than removed.
  const filter: PatientFilter | undefined =
    filterParam === "recent" || filterParam === "high_risk" || filterParam === "programme"
      ? filterParam
      : filterParam === "mine" || mine === "1"
        ? "mine"
        : undefined;

  const supabase = await createClient();

  let restrictedIds: string[] | null = null;
  // A filter's id lookup can fail on its own, separately from the roster read
  // below. When it did, it returned `[]` and the tab rendered its own empty
  // state: "No patients are assigned to you on the care team yet." for a
  // clinician who has a full panel, or "No patient currently has a high or
  // very-high prevention risk tier on file" for an org that does.
  let filterFailed = false;
  if (filter) {
    const result = await loadFilteredPatientIds(supabase, filter);
    restrictedIds = result.ids;
    filterFailed = result.failed;
  }
  // Captured before the condition search can touch restrictedIds, so the
  // empty state below can tell "this tab itself has no patients" apart from
  // "this tab's patients don't have that condition" — the two need
  // different messages (and the first one is EMPTY_STATE[filter], not a
  // claim about the condition search that was never actually evaluated).
  const filterAloneEmpty = !!filter && !filterFailed && restrictedIds !== null && restrictedIds.length === 0;

  // Condition search intersects with (rather than replaces) a filter tab's
  // id list, the same way the roster query below ANDs `q` and `filter`
  // together — "Assigned to me" + "diabetes" narrows to both, it doesn't
  // pick one. Skipped once a filter tab has already resolved to zero ids:
  // the intersection is empty either way, so the condition query would just
  // be a wasted round trip.
  let conditionFailed = false;
  let conditionTruncated = false;
  if (!filterFailed && condition?.trim() && !filterAloneEmpty) {
    // Scope the condition query itself to the filter tab's own candidate
    // ids, when one is already active, rather than searching org-wide and
    // intersecting after the fact. Without this, a narrow tab (e.g.
    // "Assigned to me") combined with a common condition could silently
    // lose real matches: an org-wide search capped at CAP rows, ordered by
    // patient_id (an effectively arbitrary order relative to who's
    // assigned to this clinician), has no guarantee any of a small tab's
    // own patients fall within that cap at all.
    const result = await loadConditionPatientIds(supabase, condition.trim(), restrictedIds);
    conditionFailed = result.failed;
    conditionTruncated = result.truncated;
    if (!result.failed) {
      if (restrictedIds === null) {
        restrictedIds = result.ids;
      } else {
        const conditionIdSet = new Set(result.ids);
        restrictedIds = restrictedIds.filter((id) => conditionIdSet.has(id));
      }
    }
  }
  const scopeFailed = filterFailed || conditionFailed;
  const scopeApplied = !!filter || !!condition?.trim();

  let rosterFailed = false;
  let patients: { id: string; full_name: string | null; patient_number: string | null; phone: string | null }[] = [];
  if (!scopeFailed && (!scopeApplied || (restrictedIds && restrictedIds.length > 0))) {
    let query = supabase
      .from("profiles")
      .select("id, full_name, patient_number, phone")
      .eq("role", "patient")
      .order("full_name", { ascending: true })
      .limit(200);
    if (q?.trim()) {
      query = query.ilike("full_name", `%${q.trim()}%`);
    }
    if (restrictedIds) {
      query = query.in("id", restrictedIds);
    }
    const { data, error } = await query;
    rosterFailed = error !== null;
    patients = data ?? [];
    // "Recent" has a real order (most-recently-viewed first) that the
    // full_name sort above would otherwise discard.
    if (filter === "recent" && restrictedIds) {
      const order = new Map(restrictedIds.map((id, i) => [id, i]));
      patients = [...patients].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
  }

  const loadFailed = scopeFailed || rosterFailed;

  function tabHref(value: PatientFilter | undefined): string {
    const params = new URLSearchParams();
    if (q?.trim()) params.set("q", q.trim());
    if (condition?.trim()) params.set("condition", condition.trim());
    if (value) params.set("filter", value);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Patients</h1>
          <p className="text-sm text-charcoal-ink/60">
            Everyone enrolled with your organisation. Open a patient to review
            their record, results, and care plan.
          </p>
        </div>
        <Link
          href={filter === "mine" ? "/clinician/patients/monitoring?mine=1" : "/clinician/patients/monitoring"}
          className="rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm font-medium text-charcoal-ink/70 hover:text-charcoal-ink"
        >
          Monitoring view
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form method="GET" className="flex flex-wrap gap-2">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name"
            aria-label="Search patients by name"
            className="w-full max-w-sm rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm text-charcoal-ink placeholder:text-charcoal-ink/40 focus:border-brand-green focus:outline-none"
          />
          <input
            type="search"
            name="condition"
            defaultValue={condition ?? ""}
            placeholder="Search by condition (e.g. hypertension)"
            aria-label="Filter patients by condition"
            className="w-full max-w-sm rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm text-charcoal-ink placeholder:text-charcoal-ink/40 focus:border-brand-green focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-deep-forest"
          >
            Search
          </button>
        </form>
        <div className="flex flex-wrap gap-1 rounded-lg border border-charcoal-ink/15 bg-white p-1 text-sm">
          {FILTER_TABS.map((tab) => (
            <Link
              key={tab.label}
              href={tabHref(tab.value)}
              className={`rounded-md px-3 py-1.5 font-medium ${
                filter === tab.value
                  ? "bg-brand-green/10 text-deep-forest"
                  : "text-charcoal-ink/60 hover:text-charcoal-ink"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {/* Every active dimension shown together — a filter tab alone
                used to be enough, but with condition/name search stackable
                on top of it, showing only the tab name made an already-
                narrowed count (e.g. "Assigned to me (3)") look like the
                clinician's whole panel. */}
            {[
              filter ? FILTER_TABS.find((t) => t.value === filter)?.label : null,
              condition?.trim() ? `Condition: “${condition.trim()}”` : null,
              q?.trim() ? `Name: “${q.trim()}”` : null,
            ]
              .filter((part): part is string => !!part)
              .join(" · ") || "All patients"}
            {loadFailed ? "" : ` (${patients.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* "No patients enrolled yet." on the org directory is the same
              false all-clear as an empty worklist: a clinician who cannot
              find a patient here concludes the patient is not on the
              platform, and goes no further. */}
          {/* Rendered above every branch below, including the empty and
              failure states — a truncated condition search can still turn
              up zero patients after intersecting with `q`/a filter tab, and
              that empty result must not read as a definitive "no match"
              when only the first 300 matching records were ever checked. */}
          {conditionTruncated && !conditionFailed && (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
              This condition search stopped after checking 300 matching
              patient_conditions records, so it may not have checked every patient on file. Narrow
              the condition text for a complete result.
            </p>
          )}
          {loadFailed ? (
            <LoadFailure>
              {conditionFailed
                ? "The condition search could not run. This is not a report that no patient has a matching condition — reload the page, or clear the condition search, rather than assuming none was found."
                : <>
                    The patient directory could not be loaded. This is not a report that there are no
                    patients{filter ? " on this tab" : ""}. Reload the page, and if it keeps failing,
                    raise it with the platform team rather than assuming a patient is not enrolled.
                  </>}
            </LoadFailure>
          ) : patients.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              {emptyRosterMessage({ filter, filterAloneEmpty, condition, q })}
            </p>
          ) : (
            <ReminderFrequencySelector patients={patients} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One patient-id array per filter tab. Returns `[]` (never null) once a
 * filter is chosen, so an unauthenticated edge case or an empty result set
 * both correctly render the tab's empty state rather than silently falling
 * back to the unfiltered roster.
 *
 * `failed` is reported separately from an empty `ids`, because those two mean
 * opposite things to the reader: "nobody is assigned to you" and "we could
 * not find out who is assigned to you" produced the same screen until this
 * distinction existed. The high-risk branch already logged its error to the
 * server console, which nobody looking at the page can see.
 */
type FilteredPatientIds = { ids: string[]; failed: boolean };

async function loadFilteredPatientIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: PatientFilter,
): Promise<FilteredPatientIds> {
  if (filter === "mine") {
    const currentUser = await getCurrentUser();
    if (!currentUser) return { ids: [], failed: false };
    const { data, error } = await supabase
      .from("care_team_assignment")
      .select("patient_id")
      .eq("clinician_id", currentUser.id);
    if (error) return { ids: [], failed: true };
    return { ids: (data ?? []).map((a) => a.patient_id), failed: false };
  }

  if (filter === "recent") {
    const currentUser = await getCurrentUser();
    if (!currentUser) return { ids: [], failed: false };
    // audit_log has one row per view, not one per patient — dedupe here
    // (Supabase JS has no DISTINCT ON) keeping the first (most recent, since
    // the query is already ordered desc) occurrence of each patient id.
    const { data, error } = await supabase
      .from("audit_log")
      .select("entity_id, created_at")
      .eq("actor_id", currentUser.id)
      .eq("action", "clinician.patient_record_viewed")
      .eq("entity_type", "patient")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return { ids: [], failed: true };
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const row of data ?? []) {
      if (row.entity_id && !seen.has(row.entity_id)) {
        seen.add(row.entity_id);
        ids.push(row.entity_id);
      }
    }
    return { ids: ids.slice(0, 50), failed: false };
  }

  if (filter === "high_risk") {
    const { data, error } = await supabase.rpc("high_risk_patient_ids");
    if (error) {
      console.error("Failed to load high-risk patient ids", error);
      return { ids: [], failed: true };
    }
    return { ids: (data ?? []).map((row) => row.patient_id), failed: false };
  }

  // filter === "programme"
  const { data, error } = await supabase
    .from("preventive_programme_enrolments")
    .select("patient_id")
    .eq("status", "enrolled");
  if (error) return { ids: [], failed: true };
  return { ids: [...new Set((data ?? []).map((row) => row.patient_id))], failed: false };
}

/**
 * Patient ids with at least one patient_conditions row whose condition_name
 * matches (plain ilike, no ranking/matching — a literal name filter on an
 * existing column, same shape as the name search above). RLS
 * (private.is_org_staff, per patient_conditions' own policy) scopes this to
 * the caller's organisation the same way the roster query below is scoped;
 * this function does not touch RLS or add any org-crossing path.
 *
 * Deliberately not filtered by `status` — it matches a condition_name on
 * file regardless of clinical_status (active/controlled/resolved/
 * historical/etc.), so the copy this feeds never claims a patient
 * "currently" has the condition, only that one is on file.
 *
 * Capped like the roster query below (and unlike the "mine"/"high_risk"/
 * "programme" branches above, which have no cap at all — a pre-existing gap
 * this diff doesn't extend) — condition name is free text a clinician is
 * likely to search for one of this platform's own core chronic-disease
 * categories (hypertension, diabetes), which can plausibly match hundreds
 * of rows in a real org. Capped at a deliberately conservative 300, not
 * the ~1000+ a GET `.in()` filter can sometimes carry before hitting a
 * proxy/gateway URL-length limit — a few hundred UUIDs (roughly 36 bytes
 * each once serialized) is already within reach of common search terms, so
 * the cap is set to stay comfortably under that risk rather than up
 * against it.
 *
 * Deliberately a plain `ilike`, not `patient_conditions.search_vector`
 * (the ranked full-text column from `20260830004048_patient_record_search.sql`)
 * — this is a literal name filter on the patient directory, not a ranked
 * search result; reaching for the ranking-capable column here would blur
 * exactly the line this task's own guardrail draws against building a
 * scoring/matching engine.
 *
 * `truncated` is true only when strictly more than CAP rows actually
 * exist — fetching CAP+1 and checking for that extra row, rather than
 * checking `length >= CAP` against a `.limit(CAP)` fetch, so a condition
 * that matches exactly CAP rows (a real, complete result) isn't shown the
 * same "may not have checked every patient" caveat as a genuinely
 * truncated one. Ordered by `patient_id` specifically so which rows get
 * kept is at least deterministic across reloads once truncation kicks in —
 * without an explicit order, Postgres/PostgREST give no guarantee which
 * rows a `LIMIT` keeps, so the exact same search could silently surface a
 * different subset of matching patients each time.
 *
 * `scopeToPatientIds`, when given (a filter tab's own already-resolved id
 * list), is applied as an `.in("patient_id", ...)` filter on this SAME
 * query rather than intersecting after the fact — critical once a CAP
 * exists: an org-wide search ordered by patient_id has no guarantee that a
 * *specific* small tab's own patients (e.g. "Assigned to me") fall within
 * the first CAP rows at all, so a caller that only intersected afterward
 * could silently lose real matches that a common condition search pushed
 * past the cap. Scoping the query itself means the cap only ever applies
 * within the tab's own (typically much smaller) candidate set.
 */
async function loadConditionPatientIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  condition: string,
  scopeToPatientIds: string[] | null,
): Promise<FilteredPatientIds & { truncated: boolean }> {
  const CAP = 300;
  let query = supabase
    .from("patient_conditions")
    .select("patient_id")
    .ilike("condition_name", `%${condition}%`);
  if (scopeToPatientIds !== null) {
    query = query.in("patient_id", scopeToPatientIds);
  }
  const { data, error } = await query.order("patient_id", { ascending: true }).limit(CAP + 1);
  if (error) return { ids: [], failed: true, truncated: false };
  const rows = data ?? [];
  const truncated = rows.length > CAP;
  return {
    // `rows` carries duplicate patient_ids when one patient has more than
    // one matching condition row — dedupe for the id list itself, but
    // `truncated` is decided on the raw row count (capped fetch), since
    // that's what determines whether more matching rows exist beyond what
    // was fetched, independent of how many distinct patients they belong to.
    ids: [...new Set(rows.slice(0, CAP).map((row) => row.patient_id))],
    failed: false,
    truncated,
  };
}
