"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSupportTicket } from "./actions";
import { SUPPORT_TICKET_CATEGORY_LABEL, supportTicketCategorySchema } from "@/lib/validation/support-tickets";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { ticketKeys } from "@/lib/queries/support-tickets";
import { Button } from "@/components/ui/button";

/**
 * §24.4's ticket-filing form. If the free text reads like a real emergency,
 * the action never creates a ticket — it raises an emergency_events row
 * instead (§24.7), and this form surfaces that exactly the way
 * DangerSymptomCheck does: invalidate the active-emergency query so the
 * global EmergencyAlert (mounted once in (sections)/layout.tsx) takes over
 * the screen immediately, no separate UI needed here.
 */
export function CreateTicketForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(createSupportTicket, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state && "emergencyDetected" in state && state.emergencyDetected) {
      queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
    }
    if (state && "success" in state && state.success) {
      queryClient.invalidateQueries({ queryKey: ticketKeys.mine(patientId) });
    }
  }, [state, queryClient, patientId]);

  const categories = supportTicketCategorySchema.options;

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="ticket-category" className="mb-1 block text-sm font-medium text-charcoal-ink">
          What&apos;s this about?
        </label>
        <select
          id="ticket-category"
          name="category"
          required
          className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
        >
          {categories.map((category) => (
            <option key={category} value={category}>
              {SUPPORT_TICKET_CATEGORY_LABEL[category]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ticket-subject" className="mb-1 block text-sm font-medium text-charcoal-ink">
          Subject
        </label>
        <input
          id="ticket-subject"
          name="subject"
          required
          maxLength={200}
          placeholder="Short summary"
          className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
        />
      </div>

      <div>
        <label htmlFor="ticket-description" className="mb-1 block text-sm font-medium text-charcoal-ink">
          Tell us what&apos;s happening
        </label>
        <textarea
          id="ticket-description"
          name="description"
          required
          rows={4}
          maxLength={4000}
          placeholder="The more detail you give, the faster your care team can help."
          className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
        />
      </div>

      {state && "error" in state && state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state && "success" in state && state.success && (
        <p className="text-sm text-brand-green">Sent — your care team will get back to you soon.</p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send to your care team"}
      </Button>
    </form>
  );
}
