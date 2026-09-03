import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadLatestSocialDeterminantScreening } from "@/lib/healthy-ageing/loaders";
import { SocialDeterminantsForm } from "./social-determinants-form";

/**
 * Spec §50.12: living alone, transport, money, caregiver limits, and access
 * to care should trigger support/navigation, not sit as demographic trivia.
 * follow_up_status is entirely server-computed (see the migration) — this
 * card only ever shows what the database decided, never a client guess.
 */
export async function SocialDeterminantsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const latest = await loadLatestSocialDeterminantScreening(supabase, patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support at home</CardTitle>
        <CardDescription>
          A few questions about day-to-day life. These help us connect you with the right support, not
          just record them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {latest?.needsNavigationSupport && (
          <div className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 p-3">
            <p className="text-sm text-charcoal-ink">
              {latest.followUpStatus === "resolved" ? "Follow-up completed" : "A care coordinator will follow up"}
            </p>
            <Badge variant={latest.followUpStatus === "resolved" ? "green" : "amber"}>
              {latest.followUpStatus === "pending" ? "Pending" : latest.followUpStatus === "contacted" ? "Contacted" : "Resolved"}
            </Badge>
          </div>
        )}
        <SocialDeterminantsForm />
      </CardContent>
    </Card>
  );
}
