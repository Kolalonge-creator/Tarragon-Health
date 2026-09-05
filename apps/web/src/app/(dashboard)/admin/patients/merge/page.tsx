import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MergeTool, type MergeCandidate, type RecordWeight } from "./merge-tool";

/**
 * How much clinical history each candidate carries. Choosing which record
 * survives from name, patient number, DOB and phone alone tells an operator
 * nothing about which one holds the patient's actual care history — and the
 * dry-run preview only runs after that choice has been made. These counts put
 * the deciding fact on screen first.
 *
 * Counts only, never the content: this page never needed to read a patient's
 * readings or medications, and should not start.
 */
async function recordWeight(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string
): Promise<RecordWeight> {
  const count = async (
    table: "vitals_readings" | "medications" | "screening_results" | "lab_result_documents" | "appointments"
  ) => {
    const { count: rows } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("patient_id", profileId);
    return rows ?? 0;
  };
  const [vitals, medications, screeningResults, resultDocuments, appointments] = await Promise.all([
    count("vitals_readings"),
    count("medications"),
    count("screening_results"),
    count("lab_result_documents"),
    count("appointments"),
  ]);
  return { vitals, medications, results: screeningResults + resultDocuments, appointments };
}

/**
 * §82.7 patient-record merge — the highest-stakes tool in the identity spec. Reached from
 * /admin/patients/duplicates ("Review & merge" on a flagged pair), never a standalone entry
 * point without two specific profile ids — see docs/PATIENT_IDENTITY_MPI_SPEC.md §3/§4 for why
 * this stays gated behind an explicit reason + a dry-run preview before any row moves.
 */
export default async function AdminPatientMergePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!profile || (!isSuperAdmin && !keys.has("patients.merge"))) {
    redirect("/admin");
  }

  const { a, b } = await searchParams;

  const supabase = await createClient();
  let candidateA: MergeCandidate | null = null;
  let candidateB: MergeCandidate | null = null;
  if (a && b) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, patient_number, date_of_birth, phone, created_at, role")
      .in("id", [a, b]);
    const rowA = (data ?? []).find((p) => p.id === a && p.role === "patient") ?? null;
    const rowB = (data ?? []).find((p) => p.id === b && p.role === "patient") ?? null;
    if (rowA && rowB) {
      const [weightA, weightB] = await Promise.all([
        recordWeight(supabase, rowA.id),
        recordWeight(supabase, rowB.id),
      ]);
      candidateA = { ...rowA, weight: weightA };
      candidateB = { ...rowB, weight: weightB };
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Merge patient records"
        description="Repoints every table that references the losing record onto the kept record, then retires the losing record. All-or-nothing: a preview always runs first, and a genuine conflict rolls the whole merge back rather than merging half of it."
      />

      {candidateA && candidateB ? (
        <Card>
          <CardHeader>
            <CardTitle>Choose which record survives</CardTitle>
          </CardHeader>
          <CardContent>
            <MergeTool candidateA={candidateA} candidateB={candidateB} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm text-charcoal-ink/70">
              This tool needs two specific patient records to compare. Start from the{" "}
              <Link href="/admin/patients/duplicates" className="text-brand-green underline">
                duplicate patients
              </Link>{" "}
              queue and choose &ldquo;Review &amp; merge&rdquo; on a flagged pair.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
