import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DuplicateFlagActions } from "./duplicate-flag-actions";
import { RunSweepButton } from "./run-sweep-button";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * §82.6 duplicate-patient review queue. Flags are computed by
 * private.sweep_duplicate_patient_candidates() (daily cron + this page's "run now" button) — this
 * page only reads and lets a reviewer dismiss a false positive or hand a real pair to the merge
 * tool. See docs/PATIENT_IDENTITY_MPI_SPEC.md §82.6/§82.7 for why detection and merge are two
 * separate, deliberately narrow surfaces.
 */
export default async function AdminPatientDuplicatesPage() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!profile || (!isSuperAdmin && !keys.has("patients.duplicates.review"))) {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: flags } = await supabase
    .from("patient_duplicate_flags")
    .select("*")
    .order("confidence", { ascending: false });

  const open = (flags ?? []).filter((f) => f.status === "open");
  const reviewed = (flags ?? []).filter((f) => f.status !== "open");

  const profileIds = Array.from(
    new Set((flags ?? []).flatMap((f) => [f.profile_id_a, f.profile_id_b])),
  );
  const { data: profiles } = profileIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, date_of_birth, phone, patient_number")
        .in("id", profileIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  function renderPair(a: string, b: string) {
    const pa = profileById.get(a);
    const pb = profileById.get(b);
    return (
      <div className="grid grid-cols-2 gap-3">
        {[pa, pb].map((p, i) => (
          <div key={i} className="rounded-md border border-charcoal-ink/10 p-2">
            <p className="text-sm font-medium text-charcoal-ink">{p?.full_name ?? "Unnamed patient"}</p>
            <p className="text-xs text-charcoal-ink/60">{p?.patient_number ?? "No patient number"}</p>
            <p className="text-xs text-charcoal-ink/60">DOB {formatDate(p?.date_of_birth ?? null)}</p>
            <p className="text-xs text-charcoal-ink/60">{p?.phone ?? "No phone on file"}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Duplicate patients</h1>
          <p className="text-charcoal-ink/60">
            Possible duplicate patient records, flagged by name/DOB/phone/email similarity. Flagging
            never merges anything. Review each pair and either dismiss it or hand it to the merge
            tool.
          </p>
        </div>
        <RunSweepButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting review ({open.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {open.length === 0 && <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>}
          {open.map((f) => (
            <div key={f.id} className="rounded-md border border-charcoal-ink/10 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant={f.confidence >= 0.7 ? "red" : f.confidence >= 0.5 ? "amber" : "grey"}>
                  {Math.round(f.confidence * 100)}% match
                </Badge>
                {(f.reasons as { same_phone?: boolean })?.same_phone && (
                  <Badge variant="blue">Same phone</Badge>
                )}
                {(f.reasons as { same_email?: boolean })?.same_email && (
                  <Badge variant="blue">Same email</Badge>
                )}
                {(f.reasons as { same_date_of_birth?: boolean })?.same_date_of_birth && (
                  <Badge variant="blue">Same DOB</Badge>
                )}
              </div>
              {renderPair(f.profile_id_a, f.profile_id_b)}
              <DuplicateFlagActions flagId={f.id} profileIdA={f.profile_id_a} profileIdB={f.profile_id_b} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviewed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reviewed.length === 0 && <p className="text-sm text-charcoal-ink/60">Nothing reviewed yet.</p>}
          {reviewed.map((f) => (
            <div key={f.id} className="flex items-start justify-between gap-3 rounded-md border border-charcoal-ink/10 p-3">
              {renderPair(f.profile_id_a, f.profile_id_b)}
              <Badge variant={f.status === "merged" ? "green" : "grey"}>{f.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
