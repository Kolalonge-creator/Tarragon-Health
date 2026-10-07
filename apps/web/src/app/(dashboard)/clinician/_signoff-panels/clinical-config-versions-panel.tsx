import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import {
  clinicalConfigVersionRowSchema,
  independentClinicalReviewRowSchema,
  type ClinicalConfigVersionRow,
  type IndependentClinicalReviewRow,
} from "@tarragon/shared";
import { ClinicalConfigVersionsView } from "./clinical-config-versions-view";

/**
 * The S88 clinical config sign-off panel: loads its own data and renders every kind's values,
 * sources, verify flag and independent-review status, with a Sign control that is disabled (and says
 * why) until the database would accept it. Opened inline by the sign-off hub; access is gated by the
 * page that renders it (canAssignCases). The sign RPC is the real gate.
 */
export async function ClinicalConfigVersionsPanel() {
  const supabase = await createClient();
  const [versionsRes, reviewsRes] = await Promise.all([
    supabase
      .from("clinical_config_versions")
      .select("id, config_kind, version, content, sources, verify_against_source, founder_position, founder_position_date, notes, status, approved_at")
      .order("config_kind", { ascending: true })
      .order("version", { ascending: false }),
    supabase
      .from("independent_clinical_reviews")
      .select("id, config_version_id, reviewer_name, mdcn_number, reviewed_at, outcome, note")
      .order("reviewed_at", { ascending: false }),
  ]);

  const versions = versionsRes.error ? null : versionsRes.data?.map((r) => clinicalConfigVersionRowSchema.safeParse(r));
  const reviews = reviewsRes.error ? null : reviewsRes.data?.map((r) => independentClinicalReviewRowSchema.safeParse(r));
  const failed = !versions || !reviews || versions.some((v) => !v.success) || reviews.some((r) => !r.success);

  if (failed) {
    return (
      <LoadFailure>
        The clinical config drafts or their independent reviews could not be loaded. This is not an all-clear and
        nothing can be signed from here until they load. Reload, and do not sign anything unseen.
      </LoadFailure>
    );
  }

  return (
    <ClinicalConfigVersionsView
      rows={versions.flatMap((v): ClinicalConfigVersionRow[] => (v.success ? [v.data] : []))}
      reviews={reviews.flatMap((r): IndependentClinicalReviewRow[] => (r.success ? [r.data] : []))}
    />
  );
}
