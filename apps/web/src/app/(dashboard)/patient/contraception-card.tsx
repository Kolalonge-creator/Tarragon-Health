"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveContraceptionMethod } from "./womens-health-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/**
 * Contraception (§44.5): enquiry -> education -> clinical consultation where
 * needed -> method selected -> prescription/service -> follow-up. Education
 * already lives in health_education_content ("Contraception options" etc.);
 * "clinical consultation where needed" books an ordinary appointment through
 * the existing appointment engine rather than a new booking flow; a
 * prescribed method becomes an ordinary row in the existing medications
 * table once a clinician prescribes it. The one new piece here is letting
 * the patient record which method they're currently using.
 */
export function ContraceptionCard({
  initialMethod,
  cautionNote,
}: {
  initialMethod: string | null;
  cautionNote?: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveContraceptionMethod, undefined);
  const errorId = fieldErrorId("current_contraception_method");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contraception</CardTitle>
        <CardDescription>
          Learn about your options, and let us know what you&apos;re currently using so your care
          team has the full picture.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cautionNote && (
          <div className="rounded-md border border-amber-300 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/10 p-3 text-sm text-charcoal-ink/90 dark:text-night-ink/90">
            <p className="font-medium text-amber-800 dark:text-amber-300">Worth discussing with your care team</p>
            <p className="mt-1">{cautionNote}</p>
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="current_contraception_method">Current method</Label>
            <Input
              id="current_contraception_method"
              name="current_contraception_method"
              placeholder="e.g. combined pill, implant, condoms, none"
              defaultValue={initialMethod ?? ""} {...fieldErrorProps(errorId, Boolean(state?.error))}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
        <FormError id={errorId} message={state?.error} />
        {state?.success && <p className="text-sm text-brand-green dark:text-brand-green-bright">Saved.</p>}

        <div className="flex flex-wrap gap-3 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
          <Link
            href="/patient/learn"
            className="text-sm font-medium text-deep-forest dark:text-brand-green-bright underline underline-offset-2"
          >
            Read about contraception options
          </Link>
          <Link
            href="/patient/appointments"
            className="text-sm font-medium text-deep-forest dark:text-brand-green-bright underline underline-offset-2"
          >
            Book a contraception consultation
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
