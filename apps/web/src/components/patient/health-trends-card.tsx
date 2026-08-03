import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadPatientClinicalContext } from "@/lib/clinical/patient-clinical-context";
import { describeForClinician, describeForPatient } from "@/lib/rules/longitudinal";

/**
 * "Your creatinine has risen at three consecutive checks."
 *
 * The thing a one-off lab visit structurally cannot tell someone, because it
 * has no memory of the last one. Rendered from the same computation for both
 * audiences — `audience` only changes the words, never the finding — so a
 * patient and their doctor can never be looking at different facts.
 *
 * Describes movement, never interprets it. No verdict, no condition named, no
 * urgency graded: that is the care team's job, and the copy says so.
 */
export async function HealthTrendsCard({
  patientId,
  audience,
}: {
  patientId: string;
  audience: "patient" | "clinician";
}) {
  const supabase = await createClient();
  const { trends } = await loadPatientClinicalContext(supabase, patientId);

  if (trends.length === 0) {
    if (audience === "clinician") {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Trends over time</CardTitle>
            <CardDescription>
              No analyte has three or more results moving consistently in one direction yet.
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }
    // A patient with too little history gets nothing rather than an empty box
    // telling them their record is thin.
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{audience === "patient" ? "What has changed over time" : "Trends over time"}</CardTitle>
        <CardDescription>
          {audience === "patient"
            ? "Patterns across your results that a single test cannot show. This describes what has moved, not what it means."
            : "Consecutive same-direction movements across stored analytes, noise-filtered per analyte."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {trends.map((finding) => (
            <li key={finding.code} className="flex gap-3">
              <Badge variant={finding.significance === "outside_range" ? "amber" : "grey"}>
                {finding.direction === "rising" ? "Up" : "Down"}
              </Badge>
              <p className="text-sm text-charcoal-ink/85">
                {audience === "patient" ? describeForPatient(finding) : describeForClinician(finding)}
              </p>
            </li>
          ))}
        </ul>
        {audience === "patient" ? (
          <p className="mt-3 text-xs text-charcoal-ink/55">
            Your care team sees these same patterns alongside everything else in your record.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
