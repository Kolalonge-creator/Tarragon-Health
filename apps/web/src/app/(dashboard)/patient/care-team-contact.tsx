import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { MessagesFlow } from "./messages-flow";

/**
 * Gated under 'doctor_checkin' (see RequiresEntitlement usage in page.tsx).
 *
 * Two-way patient<->care-team conversation happens exclusively in-app, via
 * care_messages (see messages-flow.tsx); a notification may say a reply is
 * waiting, but the conversation itself always lives here.
 */
export function CareTeamContact({ patientId }: { patientId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Your care team
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Your care team checks in with you on the schedule your plan sets out, and you can
          message them here, in the app, any time you have a question. A real person on the
          team replies, and every message stays on your record.
        </p>
        <MessagesFlow patientId={patientId} />
      </CardContent>
    </Card>
  );
}
