import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { formatNumber } from "@/lib/analytics/format";
import { startOfLagosDayUtc } from "@/lib/ai-coach/lagos-day";
import {
  LabLiaisonWorklist,
  type LiaisonPatient,
  type RecentUpload,
} from "./liaison-worklist";

/**
 * Lab Liaison Officer dashboard. Labs that don't log into Tarragon email a
 * patient's result to the liaison, who finds the patient here and uploads the
 * document into their record. RLS (private.is_org_staff) is the real gate on
 * both the patient list and the recent-uploads feed — a liaison only ever sees
 * their own organisation's patients and documents.
 */
export default async function LabLiaisonPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const now = new Date();
  const todayStartIso = startOfLagosDayUtc(now).toISOString();
  const weekStartIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: patientRows },
    { data: recentRows },
    { count: patientCount },
    { count: awaitingReviewCount },
    { count: uploadedTodayCount },
    { count: uploadedThisWeekCount },
  ] = await Promise.all([
    // Org patients the liaison can upload for (RLS-scoped). Capped at 200 for
    // the client-side search; large orgs would move this to server-side search.
    supabase
      .from("profiles")
      .select("id, full_name, patient_number, phone")
      .eq("role", "patient")
      .order("full_name", { ascending: true })
      .limit(200),
    supabase
      .from("lab_result_documents")
      .select(
        "id, source, original_filename, note, created_at, reviewed_at, profiles!lab_result_documents_patient_id_fkey(full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "patient"),
    // Org-wide, not capped to the 20-row recent feed above — this is the real
    // "how much is waiting" number, not an approximation from a page of it.
    supabase
      .from("lab_result_documents")
      .select("id", { count: "exact", head: true })
      .is("reviewed_at", null),
    supabase
      .from("lab_result_documents")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStartIso),
    supabase
      .from("lab_result_documents")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStartIso),
  ]);

  const patients: LiaisonPatient[] = (patientRows ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    patientNumber: p.patient_number,
    phone: p.phone,
  }));

  const recent: RecentUpload[] = (recentRows ?? []).map((row) => ({
    id: row.id,
    patientName: row.profiles?.full_name ?? null,
    source: row.source,
    originalFilename: row.original_filename,
    note: row.note,
    createdAt: row.created_at,
    reviewed: row.reviewed_at != null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Lab liaison</h1>
        <p className="text-charcoal-ink/60">
          Upload patient results emailed to Tarragon by partner labs.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={SEMANTIC_ICON.parentCare}
          label="Patients in your org"
          value={formatNumber(patientCount ?? 0)}
        />
        <StatTile
          icon={SEMANTIC_ICON.labs}
          label="Uploaded today"
          value={formatNumber(uploadedTodayCount ?? 0)}
          delta={{ text: "Since midnight, Lagos time", direction: "flat" }}
        />
        <StatTile
          icon={NAV_ICON.upload}
          label="Uploaded this week"
          value={formatNumber(uploadedThisWeekCount ?? 0)}
          delta={{ text: "Last 7 days", direction: "flat" }}
        />
        <StatTile
          icon={NAV_ICON.review}
          tintClassName={(awaitingReviewCount ?? 0) > 0 ? "bg-amber-100" : undefined}
          iconClassName={(awaitingReviewCount ?? 0) > 0 ? "text-amber-700" : undefined}
          label="Awaiting clinician review"
          value={formatNumber(awaitingReviewCount ?? 0)}
          delta={{
            text: (awaitingReviewCount ?? 0) > 0 ? "Across your organisation" : "All caught up",
            direction: (awaitingReviewCount ?? 0) > 0 ? "down" : "up",
          }}
        />
      </div>

      {patients.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No patients yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-charcoal-ink/60">
              There are no patients in your organisation to upload results for yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <LabLiaisonWorklist patients={patients} recent={recent} />
      )}
    </div>
  );
}
