"use client";

import { useActionState } from "react";
import { submitLead } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LEAD_ROLES } from "@/lib/validation/lead";

const ROLE_LABELS: Record<(typeof LEAD_ROLES)[number], string> = {
  patient: "Patient",
  family: "Family member / caregiver",
  employer: "Employer",
  hmo: "HMO / insurer",
  other: "Other",
};

export function ContactForm({ source = "homepage" }: { source?: string }) {
  const [state, formAction, pending] = useActionState(submitLead, undefined);

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-brand-green/20 bg-brand-green/5 p-8 text-center">
        <h2 className="font-heading text-2xl font-semibold text-charcoal-ink">Thank you.</h2>
        <p className="mt-3 text-charcoal-ink/70">
          We received your message and will be in touch shortly.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-8">
      <input type="hidden" name="source" value={source} />
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact">Email or phone</Label>
        <Input
          id="contact"
          name="contact"
          type="text"
          placeholder="you@example.com or +234XXXXXXXXXX"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role">I am a</Label>
        <Select id="role" name="role" defaultValue="patient" required>
          {LEAD_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="message">Message</Label>
        <textarea
          id="message"
          name="message"
          rows={5}
          className="flex w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          placeholder="Tell us what you want help with..."
        />
      </div>
      {state?.error ? (
        <p className="rounded-lg bg-charcoal-ink/5 p-3 text-sm text-charcoal-ink">{state.error}</p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Sending..." : "Send message"}
      </Button>
    </form>
  );
}
