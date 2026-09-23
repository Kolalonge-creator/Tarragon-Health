"use client";

import { useActionState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { submitLead } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_ROLES, LEAD_GOALS, LEAD_GOAL_LABEL } from "@/lib/validation/lead";

const ROLE_LABELS: Record<(typeof LEAD_ROLES)[number], string> = {
  patient: "Patient",
  family: "Family member / caregiver",
  employer: "Employer",
  hmo: "HMO / insurer",
  ngo: "NGO / PHC / government programme",
  other: "Other",
};

function isLeadRole(value: string | null): value is (typeof LEAD_ROLES)[number] {
  return value !== null && (LEAD_ROLES as readonly string[]).includes(value);
}

const ERROR_ID = "contact-form-error";

/**
 * `?source=corporate|hmo` is read HERE, on the client, not awaited from the
 * page's `searchParams`. Awaiting searchParams is a dynamic API, and it was
 * opting the whole /contact page out of static rendering to tag one hidden
 * input. Same fix as the homepage's channel hero; the caller wraps this in a
 * <Suspense> because `useSearchParams` suspends during prerender.
 */
export function ContactForm() {
  const searchParams = useSearchParams();
  const source = searchParams.get("source") ?? "homepage";
  // Same idea as `source`: a CTA that already knows who it's for (e.g. the
  // NGO/PHC offer on the Corporate page) can pre-select the role dropdown by
  // passing `?role=ngo`, instead of a visitor having to pick it themselves.
  // Falls back to "patient" — the default before this existed — for any
  // unrecognised or missing value.
  const roleParam = searchParams.get("role");
  const defaultRole = isLeadRole(roleParam) ? roleParam : "patient";
  const [state, formAction, pending] = useActionState(submitLead, undefined);
  const successRef = useRef<HTMLHeadingElement | null>(null);

  // The success panel replaces the whole form. Without moving focus, a
  // keyboard or screen-reader user is left on a submit button that no longer
  // exists and hears nothing at all; focusing the confirmation heading both
  // announces it and puts the tab sequence somewhere real.
  useEffect(() => {
    if (state?.success) successRef.current?.focus();
  }, [state?.success]);

  const errorMessage = state && "error" in state ? state.error : undefined;
  // Errors from this action are whole-form (a Zod issue on one of four fields,
  // or a save failure), so every field is marked as described by the one
  // message rather than guessing which field it belongs to.
  const invalid = Boolean(errorMessage);
  const describedBy = errorMessage ? ERROR_ID : undefined;

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-brand-green/20 bg-brand-green/5 p-8 text-center">
        <h2
          ref={successRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm"
        >
          Thank you.
        </h2>
        <p className="mt-3 text-charcoal-ink/70">
          We received your message and will be in touch shortly.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-8">
      <input type="hidden" name="source" value={source} />
      {/* Live region rendered unconditionally, above the fields it describes.
          A region that only appears with its message is often missed by
          screen readers, which watch an existing node for changes.
          role="alert" carries an implicit aria-live="assertive", so no
          aria-live attribute is set here: stating both is contradictory. */}
      <div role="alert" aria-atomic="true">
        {errorMessage ? (
          <p
            id={ERROR_ID}
            className="rounded-lg border border-clinical-navy/20 bg-charcoal-ink/5 p-3 text-sm text-charcoal-ink"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact">Email or phone</Label>
        <Input
          id="contact"
          name="contact"
          type="text"
          placeholder="you@example.com or +234XXXXXXXXXX"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role">I am a</Label>
        <Select
          id="role"
          name="role"
          defaultValue={defaultRole}
          required
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          {LEAD_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="goal">What brings you here? (optional)</Label>
        <Select
          id="goal"
          name="goal"
          defaultValue=""
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <option value="">Prefer not to say</option>
          {LEAD_GOALS.map((goal) => (
            <option key={goal} value={goal}>
              {LEAD_GOAL_LABEL[goal]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="message">Message</Label>
        {/* The shared primitive, like the other three fields. This was a raw
            <textarea> with a hand-copied subset of the primitive's classes, so
            it silently missed the placeholder, disabled and dark-mode styles. */}
        <Textarea
          id="message"
          name="message"
          rows={5}
          placeholder="Tell us what you want help with..."
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Sending..." : "Send message"}
      </Button>
    </form>
  );
}
