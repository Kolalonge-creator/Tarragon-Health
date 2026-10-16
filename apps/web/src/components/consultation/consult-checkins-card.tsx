import { t } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { offsetLabel, type ClinicianCheckin } from "@/lib/consult-checkin/model";

/**
 * PCC: what the patient answered in the check-ins after this visit. The data comes from get_consult_checkins(), which answers only the
 * consultation's own clinician and writes an audit row for every read (INV-10, INV-12). A failed read says so; it is never shown as
 * "no check-ins".
 */
export function ConsultCheckinsCard({ checkins, failed }: { checkins: ClinicianCheckin[] | null; failed: boolean }) {
  if (failed) {
    return (
      <p role="alert" className="text-sm text-red-600">
        We could not load the check-ins for this visit. Refresh to try again.
      </p>
    );
  }
  if (!checkins || checkins.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("consult.checkin.clinician_title", "en")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {checkins.map((c) => (
          <div key={c.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{offsetLabel(c.offset_code)}</p>
              <Badge variant={c.red_flag ? "red" : c.state === "answered" ? "green" : "amber"}>
                {c.red_flag ? "Needs attention" : c.state === "answered" ? "Answered" : c.state === "open" ? "Waiting for the patient" : c.state === "scheduled" ? "Scheduled" : c.state === "expired" ? "Not answered" : "Cancelled"}
              </Badge>
            </div>
            {c.answers && (
              <ul className="space-y-1 text-sm">
                {c.answers.map((a) => (
                  <li key={a.question}>
                    <span className="text-charcoal-ink/70 dark:text-night-ink/70">{a.question}</span> {a.answer ?? ""}
                  </li>
                ))}
              </ul>
            )}
            {c.free_text && <p className="text-sm">Note from the patient: {c.free_text}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
