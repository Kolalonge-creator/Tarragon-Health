"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert, Phone, Hospital } from "lucide-react";
import { useActiveEmergency, activeEmergencyKey } from "@/lib/queries/emergency";
import { acknowledgeEmergency, alertEmergencyContactNow } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * Site-wide emergency alert. Whenever the patient has an active, un-acknowledged
 * emergency event (from the danger-symptom check, a red-flag symptom log, or the
 * AI coach), this takes over the screen with clear triage advice.
 *
 * TarragonHealth does not provide emergency care — every path here routes the
 * patient to their nearest hospital. Acknowledging ("I'm getting help") both
 * clears the alert and suppresses the automatic message to their emergency
 * contact; "Alert my emergency contact now" sends it immediately.
 */
export function EmergencyAlert({
  patientId,
  hasEmergencyContact,
}: {
  patientId: string;
  hasEmergencyContact: boolean;
}) {
  const { data: event } = useActiveEmergency(patientId);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<"ack" | "contact" | null>(null);
  const [contactAlerted, setContactAlerted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!event) return null;

  async function handleAcknowledge() {
    if (!event) return;
    setPending("ack");
    setError(null);
    const result = await acknowledgeEmergency(event.id);
    setPending(null);
    if (result?.error) {
      setError(result.error);
      return;
    }
    queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
  }

  async function handleAlertContact() {
    if (!event) return;
    setPending("contact");
    setError(null);
    const result = await alertEmergencyContactNow(event.id);
    setPending(null);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setContactAlerted(true);
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-alert-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-ink/70 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="rounded-t-2xl bg-red-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <TriangleAlert className="h-7 w-7 shrink-0" strokeWidth={2.5} />
            <h2 id="emergency-alert-title" className="font-heading text-xl font-semibold">
              This may be a medical emergency
            </h2>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="text-base leading-relaxed text-charcoal-ink">
            TarragonHealth does not provide emergency care. If this is a medical emergency, please{" "}
            <span className="font-semibold">go to your nearest hospital or emergency department now</span>
            , or call your local emergency number.
          </p>

          <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">
            <Hospital className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2} />
            <p>
              Go to the nearest hospital&apos;s emergency department. Don&apos;t wait for a reply from
              your care team — your care team has also been notified and will follow up.
            </p>
          </div>

          {event.trigger_detail && (
            <p className="text-sm text-charcoal-ink/60">
              Reported: {event.trigger_detail}
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="space-y-3">
            {hasEmergencyContact ? (
              contactAlerted || event.contact_notified_at ? (
                <p className="flex items-center gap-2 text-sm font-medium text-brand-green">
                  <Phone className="h-4 w-4" strokeWidth={2} />
                  Your emergency contact has been alerted.
                </p>
              ) : (
                <Button
                  type="button"
                  onClick={handleAlertContact}
                  disabled={pending !== null}
                  className="w-full bg-red-600 hover:bg-red-700"
                >
                  <Phone className="mr-2 h-4 w-4" strokeWidth={2} />
                  {pending === "contact" ? "Alerting…" : "Alert my emergency contact now"}
                </Button>
              )
            ) : (
              <p className="text-sm text-charcoal-ink/70">
                You haven&apos;t saved an emergency contact yet. Add one on your dashboard so we can
                message them automatically if you don&apos;t respond.
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={handleAcknowledge}
              disabled={pending !== null}
              className="w-full"
            >
              {pending === "ack" ? "Saving…" : "I'm getting help"}
            </Button>
          </div>

          <p className="text-center text-xs text-charcoal-ink/50">
            Choosing &quot;I&apos;m getting help&quot; lets us know you&apos;re responding, so we
            won&apos;t automatically message your emergency contact.
          </p>
        </div>
      </div>
    </div>
  );
}
