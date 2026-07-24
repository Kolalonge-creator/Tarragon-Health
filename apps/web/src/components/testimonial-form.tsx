"use client";

import { useActionState } from "react";
import { submitTestimonial } from "@/app/(dashboard)/patient/testimonials/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Consented testimonial submission — never invented, never scraped. The
 * patient chooses their own display name (first name or initials are fine)
 * and explicitly consents by submitting; an admin reviews before anything
 * appears on the marketing site.
 */
export function TestimonialForm() {
  const [state, formAction, pending] = useActionState(submitTestimonial, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share your experience</CardTitle>
      </CardHeader>
      <CardContent>
        {state?.message ? (
          <p className="text-sm text-brand-green">{state.message}</p>
        ) : (
          <form action={formAction} className="space-y-3">
            <p className="text-xs text-charcoal-ink/60">
              A short quote about your Tarragon experience — with your permission, we may share it
              on our website (never your medical details, just your words).
            </p>
            <div>
              <label className="block text-xs font-medium text-charcoal-ink" htmlFor="display_name">
                How should we credit you?
              </label>
              <Input id="display_name" name="display_name" placeholder="e.g. Amina O." maxLength={80} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal-ink" htmlFor="quote">
                Your words
              </label>
              <textarea
                id="quote"
                name="quote"
                minLength={20}
                maxLength={500}
                required
                rows={3}
                className="flex w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink placeholder:text-charcoal-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
                placeholder="What made a difference for you?"
              />
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sending…" : "Submit for review"}
            </Button>
            {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
