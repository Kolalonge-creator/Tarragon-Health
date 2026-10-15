import { Badge } from "@/components/ui/badge";
import type { RedPatientResponse } from "@/lib/paging/schemas";
import { formatLagos } from "@/lib/rota/time";

/**
 * What the patient said about seeking care after the red alert (CMO Q13). Information for whoever is on call: it does not
 * acknowledge, close or silence anything, and it says so. "Could not get care" is shown in red.
 */
export function RedPatientAnswer({ answer }: { answer: RedPatientResponse }) {
  if (!answer) return null;
  const could = answer.response === "could_not_get_care";
  return (
    <div className="space-y-1 rounded-lg border border-charcoal-ink/10 p-3 text-sm" data-testid="red-patient-answer">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={could ? "red" : "green"}>{could ? "Patient says: could not get care" : "Patient says: has sought care"}</Badge>
        <span className="text-xs text-muted-foreground">Answered {formatLagos(answer.responded_at)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        This is what the patient told the app. It does not stop the paging: only your acknowledgement does.
      </p>
    </div>
  );
}
