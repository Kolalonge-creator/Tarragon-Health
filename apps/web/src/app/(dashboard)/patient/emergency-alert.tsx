"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert, Phone, Hospital } from "lucide-react";
import { useActiveEmergency, activeEmergencyKey } from "@/lib/queries/emergency";
import { acknowledgeEmergency, alertEmergencyContactNow } from "./actions";
import { Button } from "@/components/ui/button";
import { getEmergencyNumbers } from "@/lib/nigeria-emergency-numbers";

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
  state,
}: {
  patientId: string;
  hasEmergencyContact: boolean;
  state?: string | null;
}) {
  const { data: event } = useActiveEmergency(patientId);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<"ack" | "contact" | null>(null);
  const [contactAlerted, setContactAlerted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const open = Boolean(event);

  // Focus moves into the panel the moment this takes over the screen. Without
  // it a keyboard or screen-reader user is left on the page behind a dialog
  // they cannot see or reach, in the one situation where being stuck matters
  // most. The panel itself takes focus rather than a button, so the triage
  // advice is announced before the two things they can do about it.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!event) return null;

  const emergencyNumbers = getEmergencyNumbers(state);

  /**
   * Tab cycles inside the panel instead of walking out into the dashboard
   * behind it. Deliberately no Escape handler: this dialog is dismissed by
   * acknowledging it, because acknowledging is what tells us the patient is
   * responding and suppresses the automatic message to their emergency
   * contact. A silent Escape would look like an answer and mean nothing.
   */
  function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])"
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

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
      onKeyDown={trapTab}
      // items-start on a phone, centred from sm up: this panel is taller than
      // a 375x667 viewport once a Lagos patient's three emergency-number pills
      // wrap, and centring an over-tall panel in a `fixed` container pushes the
      // buttons off both ends of the screen with nothing to scroll. Both the
      // overlay and the panel scroll, so the acknowledge button is always
      // reachable. Same shape as lifestyle/goals-dialog.tsx.
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal-ink/70 p-4 sm:items-center"
    >
      <div
        ref={panelRef}
        // tabIndex -1 so the panel can take programmatic focus on open without
        // ever becoming a Tab stop of its own.
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white dark:bg-night-card shadow-xl outline-none dark:shadow-none"
      >
        <div className="rounded-t-2xl bg-red-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <TriangleAlert className="h-7 w-7 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <h2 id="emergency-alert-title" className="font-heading text-xl font-semibold">
              This may be a medical emergency
            </h2>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="text-base leading-relaxed text-charcoal-ink dark:text-night-ink">
            TarragonHealth does not provide emergency care. If this is a medical emergency, please{" "}
            <span className="font-semibold">go to your nearest hospital or emergency department now</span>
            , or call one of the numbers below.
          </p>

          <div className="flex flex-wrap gap-2">
            {emergencyNumbers.map((n) => (
              <a
                key={n.tel}
                href={`tel:${n.tel}`}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Phone className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                {n.label}: {n.number}
              </a>
            ))}
          </div>

          <div className="flex items-start gap-3 rounded-lg bg-red-50 dark:bg-red-500/15 p-4 text-sm text-red-800 dark:text-red-300">
            <Hospital className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <p>
              Go to the nearest hospital&apos;s emergency department. Don&apos;t wait for a reply from
              your care team; your care team has also been notified and will follow up.
            </p>
          </div>

          {event.trigger_detail && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              Reported: {event.trigger_detail}
            </p>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}

          <div className="space-y-3">
            {hasEmergencyContact ? (
              contactAlerted || event.contact_notified_at ? (
                <p className="flex items-center gap-2 text-sm font-medium text-brand-green dark:text-brand-green-bright">
                  <Phone className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  Your emergency contact has been alerted.
                </p>
              ) : (
                <Button
                  type="button"
                  onClick={handleAlertContact}
                  disabled={pending !== null}
                  className="w-full bg-red-600 hover:bg-red-700"
                >
                  <Phone className="mr-2 h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  {pending === "contact" ? "Alerting…" : "Alert my emergency contact now"}
                </Button>
              )
            ) : (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
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

          <p className="text-center text-xs text-charcoal-ink/50 dark:text-night-ink/55">
            Choosing &quot;I&apos;m getting help&quot; lets us know you&apos;re responding, so we
            won&apos;t automatically message your emergency contact.
          </p>
        </div>
      </div>
    </div>
  );
}
