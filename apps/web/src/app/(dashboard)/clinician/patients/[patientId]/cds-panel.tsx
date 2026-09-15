import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadCdsView } from "@/lib/cds/load-cds";
import { CdsRecommendationCard } from "./cds-recommendation-card";

/**
 * Clinical Decision Support point-of-care panel (spec §38.4): patient record
 * -> clinical context -> relevant CDS -> clinician reviews -> decision.
 *
 * ADVISORY ONLY (§38.1 "augment clinicians rather than replace them") — this
 * never blocks anything else on the page. A clean panel means "nothing in the
 * curated rule set fired right now", not "this patient has no problems".
 */
export async function CdsPanel({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const supabase = await createClient();
  const { visible, settled, overflow } = await loadCdsView(supabase, patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinical decision support</CardTitle>
        <CardDescription>
          Relevant context drawn from this patient&apos;s own record (medication safety, BP control,
          referral criteria, and due monitoring), each with its source shown and a place to record what
          you decided. Advisory: nothing here changes the record on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {visible.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">
            Nothing in the curated rule set fired for this patient right now.
          </p>
        ) : (
          visible.map((rec) => (
            <CdsRecommendationCard
              key={rec.key}
              recommendation={rec}
              patientId={patientId}
              organisationId={organisationId}
            />
          ))
        )}
        {(settled.length > 0 || overflow.length > 0) && (
          <p className="text-xs text-charcoal-ink/50">
            {settled.length > 0 && `${settled.length} already decided and unchanged since. `}
            {overflow.length > 0 &&
              `${overflow.length} more, lower priority than what's shown above: not dropped, just not shown all at once (§38.11).`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
