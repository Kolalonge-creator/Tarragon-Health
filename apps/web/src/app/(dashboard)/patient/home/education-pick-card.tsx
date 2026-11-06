import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "Learn more about your health" (spec 4.8; PD-05): one reading from the patient's own personalised feed
 * (`health_education_feed`, chosen by care-plan condition, age, reading level and recent events, never by browsing history).
 * The feed answers for the signed-in person, so it is not shown while acting for someone else. Optional content: if the feed
 * cannot be read or is empty, the card is simply not shown.
 */
export async function EducationPickCard({ acting }: { acting: boolean }) {
  if (acting) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("health_education_feed");
  if (error || !data) return null;
  const pick = data.find((item) => item.status !== "understood");
  if (!pick) return null;

  return (
    <Card data-testid="education-pick">
      <CardHeader>
        <CardTitle className="text-base">Learn more about your health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="font-semibold">{pick.title}</p>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{pick.summary}</p>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          {pick.estimated_minutes} min read
          {pick.clinician_reviewed ? (pick.reviewed_by_name ? ` · Reviewed by ${pick.reviewed_by_name}` : " · Reviewed by our clinical team") : ""}
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href={`/patient/learn/${pick.code}`} className="text-sm font-medium text-deep-forest underline dark:text-brand-green-bright">
            Read it
          </Link>
          <Link href="/patient/learn" className="text-sm text-charcoal-ink/70 underline dark:text-night-ink/70">
            Health library
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
