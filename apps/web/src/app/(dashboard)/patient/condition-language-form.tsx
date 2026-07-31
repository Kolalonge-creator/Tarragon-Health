"use client";

import { useActionState } from "react";
import { updateConditionLanguagePreference } from "./condition-language-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";

/**
 * Lets a patient choose clinical wording ("obesity") instead of the
 * platform's own default gentler wording ("weight") in their own patient
 * dashboard — the platform decides a default tone for everyone (2026-07-30
 * marketing-site-redesign pass), but a patient who prefers direct medical
 * language should be able to opt into it for themselves.
 */
export function ConditionLanguageForm({
  initial,
}: {
  initial: { condition_language_preference: string | null };
}) {
  const [state, formAction, pending] = useActionState(
    updateConditionLanguagePreference,
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.messages className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          How we talk about your weight
        </CardTitle>
        <CardDescription>
          We default to gentler wording (&ldquo;weight&rdquo;) across your dashboard. If
          you&apos;d rather see the direct clinical term (&ldquo;obesity&rdquo;) where it
          applies, you can switch it here — this only changes wording on your own screen, never
          your medical record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="condition_language_preference"
                value="gentle"
                defaultChecked={initial.condition_language_preference !== "clinical"}
              />
              Gentler wording, e.g. &quot;weight&quot; (default)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="condition_language_preference"
                value="clinical"
                defaultChecked={initial.condition_language_preference === "clinical"}
              />
              Clinical wording, e.g. &quot;obesity&quot;
            </label>
          </div>

          <Button type="submit" disabled={pending} size="sm">
            {pending ? "Saving…" : "Save preference"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
