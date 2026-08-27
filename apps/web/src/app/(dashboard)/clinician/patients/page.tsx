import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PatientFilter = "mine" | "recent" | "high_risk" | "programme";

const FILTER_TABS: { value: PatientFilter | undefined; label: string }[] = [
  { value: undefined, label: "Everyone" },
  { value: "mine", label: "Assigned to me" },
  { value: "recent", label: "Recent" },
  { value: "high_risk", label: "High-risk" },
  { value: "programme", label: "Programme" },
];

const EMPTY_STATE: Record<PatientFilter, string> = {
  mine: "No patients are assigned to you on the care team yet. Switch to “Everyone” to see the full roster.",
  recent: "You haven't opened any patient charts yet. Charts you view will show up here.",
  high_risk: "No patient currently has a high or very-high prevention risk tier on file.",
  programme: "No patient is currently enrolled in a preventive programme.",
};

/**
 * Org patient directory — the index behind the sidebar "Patients" link.
 * RLS (private.is_org_staff) scopes the query to the caller's organisation;
 * app-code filtering is limited to name search and the filter tabs below —
 * every org-staff account can still see the whole roster (cross-coverage),
 * this only changes what's shown by default.
 *
 * Care Team / Provider Workspace §5.4 asks for "assigned / programme / recent
 * / high-risk / requiring action" lists. "Requiring action" is already the
 * worklist/work-queue surface elsewhere in this app (todays-queue-panel.tsx,
 * the worklist count strip on /clinician) — duplicating it as a patient-list
 * filter here would just be a second, easier-to-drift view of the same
 * queue, so it's deliberately not one of the tabs below.
 */
export default async function ClinicianPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; mine?: string }>;
}) {
  const { q, filter: filterParam, mine } = await searchParams;
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
  if (filter) {
    restrictedIds = await loadFilteredPatientIds(supabase, filter);
  }

  let patients: { id: string; full_name: string | null; patient_number: string | null; phone: string | null }[] = [];
  if (!filter || (restrictedIds && restrictedIds.length > 0)) {
    let query = supabase
      .from("profiles")
      .select("id, full_name, patient_number, phone")
      .eq("role", "patient")
      .order("full_name", { ascending: true })
      .limit(200);
    if (q?.trim()) {
      query = query.ilike("full_name", `%${q.trim()}%`);
    }
    if (filter && restrictedIds) {
      query = query.in("id", restrictedIds);
    }
    const { data } = await query;
    patients = data ?? [];
    // "Recent" has a real order (most-recently-viewed first) that the
    // full_name sort above would otherwise discard.
    if (filter === "recent" && restrictedIds) {
      const order = new Map(restrictedIds.map((id, i) => [id, i]));
      patients = [...patients].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
  }

  function tabHref(value: PatientFilter | undefined): string {
    const params = new URLSearchParams();
    if (q?.trim()) params.set("q", q.trim());
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
        <form method="GET" className="flex gap-2">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name"
            aria-label="Search patients by name"
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
            {filter
              ? FILTER_TABS.find((t) => t.value === filter)?.label
              : q?.trim()
                ? `Results for “${q.trim()}”`
                : "All patients"}
            {` (${patients.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {patients.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              {filter
                ? EMPTY_STATE[filter]
                : q?.trim()
                  ? "No patients match that name."
                  : "No patients enrolled yet."}
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {patients.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/clinician/patients/${p.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-charcoal-ink/2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-charcoal-ink">
                        {p.full_name ?? "Unnamed patient"}
                      </span>
                      <span className="block text-xs text-charcoal-ink/50">
                        {p.patient_number ?? "No patient number"}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </span>
                    </span>
                    <span aria-hidden className="text-charcoal-ink/30">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
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
 */
async function loadFilteredPatientIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: PatientFilter,
): Promise<string[]> {
  if (filter === "mine") {
    const currentUser = await getCurrentUser();
    if (!currentUser) return [];
    const { data } = await supabase
      .from("care_team_assignment")
      .select("patient_id")
      .eq("clinician_id", currentUser.id);
    return (data ?? []).map((a) => a.patient_id);
  }

  if (filter === "recent") {
    const currentUser = await getCurrentUser();
    if (!currentUser) return [];
    // audit_log has one row per view, not one per patient — dedupe here
    // (Supabase JS has no DISTINCT ON) keeping the first (most recent, since
    // the query is already ordered desc) occurrence of each patient id.
    const { data } = await supabase
      .from("audit_log")
      .select("entity_id, created_at")
      .eq("actor_id", currentUser.id)
      .eq("action", "clinician.patient_record_viewed")
      .eq("entity_type", "patient")
      .order("created_at", { ascending: false })
      .limit(300);
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const row of data ?? []) {
      if (row.entity_id && !seen.has(row.entity_id)) {
        seen.add(row.entity_id);
        ids.push(row.entity_id);
      }
    }
    return ids.slice(0, 50);
  }

  if (filter === "high_risk") {
    const { data, error } = await supabase.rpc("high_risk_patient_ids");
    if (error) {
      console.error("Failed to load high-risk patient ids", error);
      return [];
    }
    return (data ?? []).map((row) => row.patient_id);
  }

  // filter === "programme"
  const { data } = await supabase
    .from("preventive_programme_enrolments")
    .select("patient_id")
    .eq("status", "enrolled");
  return [...new Set((data ?? []).map((row) => row.patient_id))];
}
