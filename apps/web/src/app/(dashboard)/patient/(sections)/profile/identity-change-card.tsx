"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { requestIdentityChangeAction, type IdentityChangeState } from "./identity-change-actions";
import type { IdentityField } from "./identity-change";

const ERROR_TEXT: Record<"invalid" | "not_signed_in" | "acting" | "failed", string> = {
  invalid: "Please check what you typed. A date of birth must be a real date that is not in the future.",
  not_signed_in: "Your session has ended. Sign in again, then try once more.",
  acting: "Switch back to your own account to ask for a change to your name or date of birth.",
  failed: "That could not be sent. Please try again.",
};

/**
 * P21: "Request a change to your name or date of birth". The patient cannot edit these directly; the request goes to staff, who check it
 * with the patient before anything changes (the existing right-to-rectification workflow). Hidden in favour of a plain line while a
 * supporter is acting for someone, because the request would be about the supporter's own account.
 */
export function IdentityChangeCard({
  fullName,
  dateOfBirth,
  acting,
}: {
  fullName: string | null;
  dateOfBirth: string | null;
  acting: boolean;
}) {
  const [state, formAction, pending] = useActionState<IdentityChangeState, FormData>(requestIdentityChangeAction, undefined);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<IdentityField>("full_name");
  const sent = state?.ok === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your name and date of birth</CardTitle>
        <CardDescription>
          These identify you on your records and results, so our team checks any change with you before it is made.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-charcoal-ink/60 dark:text-night-ink/60">Name</dt>
            <dd className="font-medium">{fullName?.trim() || "Not given"}</dd>
          </div>
          <div>
            <dt className="text-charcoal-ink/60 dark:text-night-ink/60">Date of birth</dt>
            <dd className="font-medium">{dateOfBirth ? formatPatientDate(dateOfBirth) : "Not given"}</dd>
          </div>
        </dl>

        {acting ? (
          <p className="text-sm">{ERROR_TEXT.acting}</p>
        ) : sent ? (
          <div className="space-y-1">
            <FormSuccess message="Sent. Our team will check this with you before anything changes." />
            <Link href="/patient/privacy" className="text-sm font-medium text-brand-green underline">Follow your request on the privacy page</Link>
          </div>
        ) : open ? (
          <form action={formAction} className="space-y-3">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What would you like changed?</legend>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="radio" name="field" value="full_name" checked={field === "full_name"} onChange={() => setField("full_name")} className="h-4 w-4 accent-brand-green" />
                My name
              </label>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="radio" name="field" value="date_of_birth" checked={field === "date_of_birth"} onChange={() => setField("date_of_birth")} className="h-4 w-4 accent-brand-green" />
                My date of birth
              </label>
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="identity-new-value">{field === "full_name" ? "What it should say" : "Your correct date of birth"}</Label>
              {field === "full_name" ? (
                <Input id="identity-new-value" name="newValue" required minLength={2} maxLength={120} autoComplete="name" />
              ) : (
                <Input id="identity-new-value" name="newValue" type="date" required min="1900-01-01" />
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="identity-reason">Why it needs changing (optional)</Label>
              <Textarea id="identity-reason" name="reason" rows={2} maxLength={500} />
            </div>
            <FormError id={fieldErrorId("identity-change")} message={state && !state.ok ? ERROR_TEXT[state.error] : undefined} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send request"}</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setOpen(true)}>Request a change to your name or date of birth</Button>
        )}
      </CardContent>
    </Card>
  );
}
