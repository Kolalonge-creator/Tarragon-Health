import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MergeTool, type MergeCandidate } from "./merge-tool";

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
      .select("id, full_name, patient_number, date_of_birth, phone, role")
      .in("id", [a, b]);
    candidateA = (data ?? []).find((p) => p.id === a && p.role === "patient") ?? null;
    candidateB = (data ?? []).find((p) => p.id === b && p.role === "patient") ?? null;
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
