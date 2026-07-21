import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Org patient directory — the index behind the sidebar "Patients" link.
 * RLS (private.is_org_staff) scopes the query to the caller's organisation;
 * no additional filtering is done in application code.
 */
export default async function ClinicianPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, full_name, patient_number, phone")
    .eq("role", "patient")
    .order("full_name", { ascending: true })
    .limit(200);
  if (q?.trim()) {
    query = query.ilike("full_name", `%${q.trim()}%`);
  }
  const { data: patients } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Patients</h1>
        <p className="text-sm text-charcoal-ink/60">
          Everyone enrolled with your organisation. Open a patient to review
          their record, results, and care plan.
        </p>
      </div>

      <form method="GET" className="flex gap-2">
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

      <Card>
        <CardHeader>
          <CardTitle>
            {q?.trim() ? `Results for “${q.trim()}”` : "All patients"}
            {patients ? ` (${patients.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!patients || patients.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              {q?.trim() ? "No patients match that name." : "No patients enrolled yet."}
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
