import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadOpenHomeCareRequest } from "@/lib/healthy-ageing/loaders";
import { HOME_CARE_STATUS_LABEL } from "@/lib/healthy-ageing/types";
import { HomeCareRequestForm } from "./home-care-request-form";

/**
 * Spec §50.13. Deliberately internal record-keeping + a care-coordinator
 * workflow, not live dispatch — Tarragon has no active home-visit clinical
 * partner yet (home_visit_providers is scoped to lab-sample collection).
 * Copy reflects that: "we'll be in touch," never a booking confirmation.
 */
export async function HomeCareRequestSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const open = await loadOpenHomeCareRequest(supabase, patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home visit</CardTitle>
        <CardDescription>
          If getting to a clinic is difficult, ask your care coordinator about a home visit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {open ? (
          <div className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">{HOME_CARE_STATUS_LABEL[open.status]}</p>
            <Badge variant="blue">In progress</Badge>
          </div>
        ) : (
          <HomeCareRequestForm />
        )}
      </CardContent>
    </Card>
  );
}
