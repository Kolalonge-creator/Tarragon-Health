import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Org patient directory — the index behind the sidebar "Patients" link.
 * RLS (private.is_org_staff) scopes the query to the caller's organisation;
 * app-code filtering is limited to name search and the optional "assigned to
 * me" toggle below — every org-staff account can still see the whole roster
 * (cross-coverage), this only changes what's shown by default.
 */
export default async function ClinicianPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mine?: string }>;
}) {
  const { q, mine } = await searchParams;
  const showMineOnly = mine === "1";
  const supabase = await createClient();

  let assignedPatientIds: string[] | null = null;
  if (showMineOnly) {
    const currentUser = await getCurrentUser();
    const { data: assignments } = currentUser
      ? await supabase
          .from("care_team_assignment")
          .select("patient_id")
          .eq("clinician_id", currentUser.id)
      : { data: [] };
    assignedPatientIds = (assignments ?? []).map((a) => a.patient_id);
  }

  let patients: { id: string; full_name: string | null; patient_number: string | null; phone: string | null }[] = [];
  if (!showMineOnly || (assignedPatientIds && assignedPatientIds.length > 0)) {
    let query = supabase
      .from("profiles")
      .select("id, full_name, patient_number, phone")
      .eq("role", "patient")
      .order("full_name", { ascending: true })
      .limit(200);
    if (q?.trim()) {
      query = query.ilike("full_name", `%${q.trim()}%`);
    }
    if (showMineOnly && assignedPatientIds) {
      query = query.in("id", assignedPatientIds);
    }
    const { data } = await query;
    patients = data ?? [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Patients</h1>
        <p className="text-sm text-charcoal-ink/60">
          Everyone enrolled with your organisation. Open a patient to review
          their record, results, and care plan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form method="GET" className="flex gap-2">
          {showMineOnly && <input type="hidden" name="mine" value="1" />}
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
        <div className="flex gap-1 rounded-lg border border-charcoal-ink/15 bg-white p-1 text-sm">
          <Link
            href={q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "?"}
            className={`rounded-md px-3 py-1.5 font-medium ${
              !showMineOnly ? "bg-brand-green/10 text-deep-forest" : "text-charcoal-ink/60 hover:text-charcoal-ink"
            }`}
          >
            Everyone
          </Link>
          <Link
            href={q?.trim() ? `?mine=1&q=${encodeURIComponent(q.trim())}` : "?mine=1"}
            className={`rounded-md px-3 py-1.5 font-medium ${
              showMineOnly ? "bg-brand-green/10 text-deep-forest" : "text-charcoal-ink/60 hover:text-charcoal-ink"
            }`}
          >
            Assigned to me
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {showMineOnly ? "Assigned to me" : q?.trim() ? `Results for “${q.trim()}”` : "All patients"}
            {` (${patients.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {patients.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              {showMineOnly
                ? "No patients are assigned to you on the care team yet. Switch to “Everyone” to see the full roster."
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
