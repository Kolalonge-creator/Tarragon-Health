"use client";

import { useActionState, useEffect, useRef } from "react";
import { createDoctorTestimonial } from "./actions";
import { TESTIMONIAL_CONDITIONS } from "@/lib/testimonials/conditions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ClinicalStaffOption = { id: string; full_name: string };

/**
 * Admin-only creation form — there is no doctor-facing equivalent of this
 * page. The admin has already obtained the doctor's off-platform consent
 * (a signed release, an email, a documented verbal OK) before ever opening
 * this form; consent_reference just records where that lives, it is not
 * itself the consent.
 *
 * Unlike the one-time patient TestimonialForm this is modeled after, an
 * admin adds MANY doctor testimonials over a session — the form used to
 * hide itself behind a permanent "Saved" message after the first success
 * (useActionState's state persists across re-renders, so the message never
 * clears on its own), which made adding a second testimonial require a full
 * page reload. The form now always stays mounted; a success banner shows
 * above it and the fields reset via the ref below instead.
 */
export function CreateDoctorTestimonialForm({ staff }: { staff: ClinicalStaffOption[] }) {
  const [state, formAction, pending] = useActionState(createDoctorTestimonial, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.message) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a doctor testimonial</CardTitle>
      </CardHeader>
      <CardContent>
        {state?.message && (
          <p className="mb-3 text-sm text-brand-green dark:text-brand-green-bright">
            {state.message}
          </p>
        )}
        <form ref={formRef} action={formAction} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-charcoal-ink dark:text-night-ink" htmlFor="clinical_staff_id">
              Which doctor is this?
            </label>
            <select
              id="clinical_staff_id"
              name="clinical_staff_id"
              required
              defaultValue=""
              className="flex h-9 w-full rounded-md border border-charcoal-ink/20 bg-white dark:bg-night-card px-3 py-1 text-sm text-charcoal-ink dark:text-night-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
            >
              <option value="" disabled>
                Choose a clinician
              </option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Kept internally for provenance only — never shown publicly. What the public sees is
              the display name below.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-ink dark:text-night-ink" htmlFor="display_name">
              Public display name
            </label>
            <Input
              id="display_name"
              name="display_name"
              placeholder="e.g. Dr. Adaeze"
              maxLength={40}
              required
            />
            <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              First name only, no surname/tier/specialty/credential — e.g. &ldquo;Dr.
              Adaeze&rdquo;, shown alongside &ldquo;TarragonHealth care team&rdquo;.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-ink dark:text-night-ink" htmlFor="condition">
              Is this about a specific condition? (optional)
            </label>
            <select
              id="condition"
              name="condition"
              defaultValue=""
              className="flex h-9 w-full rounded-md border border-charcoal-ink/20 bg-white dark:bg-night-card px-3 py-1 text-sm text-charcoal-ink dark:text-night-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
            >
              <option value="">General / not specific</option>
              {TESTIMONIAL_CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-ink dark:text-night-ink" htmlFor="quote">
              Quote
            </label>
            <textarea
              id="quote"
              name="quote"
              minLength={20}
              maxLength={500}
              required
              rows={3}
              className="flex w-full rounded-md border border-charcoal-ink/20 bg-white dark:bg-night-card px-3 py-2 text-sm text-charcoal-ink dark:text-night-ink placeholder:text-charcoal-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-ink dark:text-night-ink" htmlFor="consent_reference">
              Where is this doctor&apos;s consent to publish recorded?
            </label>
            <Input
              id="consent_reference"
              name="consent_reference"
              placeholder="e.g. Signed release, HR drive, 2026-09-24"
              maxLength={200}
              required
            />
            <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              A real, off-platform consent record (a signed release, an email, a documented
              verbal OK) must already exist before this form is filled in. This field points at
              it, it does not create it.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save as draft"}
          </Button>
          {state?.error && <p className="text-xs text-red-600 dark:text-red-300">{state.error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
