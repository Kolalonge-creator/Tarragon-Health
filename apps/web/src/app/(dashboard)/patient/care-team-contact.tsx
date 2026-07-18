import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Gated under 'doctor_checkin' (see RequiresEntitlement usage in page.tsx).
 * No phone number is hardcoded here — WhatsApp is a human-routed support
 * channel (CLAUDE.md), so the actual thread is whatever number sent the
 * patient a reminder/notification, or one their doctor initiates for a
 * scheduled check-in; inventing a fixed "contact us" number here would risk
 * it drifting from the org's real WhatsApp Business number.
 */
export function CareTeamContact() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Doctor check-ins
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-charcoal-ink/70">
          Your care team reaches out on WhatsApp for your scheduled check-ins — you can also
          reply directly on that thread any time with a question, and a real person on your care
          team will get back to you.
        </p>
      </CardContent>
    </Card>
  );
}
