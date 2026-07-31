import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { MessagesFlow } from "./messages-flow";

/**
 * Gated under 'doctor_checkin' (see RequiresEntitlement usage in page.tsx).
 *
 * Founder direction 2026-07-30: this used to promise a WhatsApp thread
 * ("your care team reaches out on WhatsApp... reply directly on that
 * thread"). Two problems with that: (1) it implied one continuous WhatsApp
 * conversation with no record on the platform itself, and (2) WhatsApp is a
 * notifications-only channel per CLAUDE.md's Non-Negotiable Business Rules —
 * two-way patient<->care-team conversation now happens exclusively in-app,
 * via care_messages (see messages-flow.tsx). WhatsApp/SMS may still *notify*
 * that a reply is waiting; the conversation itself always lives here.
 */
export function CareTeamContact({ patientId }: { patientId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your care team
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          Your care team checks in with you on the schedule your plan sets out, and you can
          message them here, in the app, any time you have a question. A real person on the
          team replies, and every message stays on your record.
        </p>
        <MessagesFlow patientId={patientId} />
      </CardContent>
    </Card>
  );
}
