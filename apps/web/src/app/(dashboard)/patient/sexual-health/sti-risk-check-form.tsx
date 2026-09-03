"use client";

import { useActionState, useState } from "react";
import { submitStiRiskCheck } from "./sti-actions";
import {
  STI_PARTNER_COUNTS,
  STI_PARTNER_COUNT_LABEL,
  STI_CONDOM_USES,
  STI_CONDOM_USE_LABEL,
  STI_SYMPTOMS,
  STI_SYMPTOM_LABEL,
  type StiSymptom,
} from "@/lib/validation/sti-risk-check";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

const RECOMMENDED_SCREEN_LABEL: Record<string, string> = {
  hiv: "HIV",
  syphilis: "Syphilis",
  chlamydia_gonorrhoea: "Chlamydia & Gonorrhoea",
  hep_b: "Hepatitis B",
  hep_c: "Hepatitis C",
};

/**
 * Sexual health check-in (spec §47.3's risk assessment). Deliberately
 * optional and never blocking. The patient never sees a "risk level" number
 * or verdict — just which tests, if any, are worth getting — and a reported
 * symptom or a high-risk pattern is handled server-side (a real clinician
 * gets a look), same warm-but-real-safety-net shape as MentalHealthScreenForm.
 */
export function StiRiskCheckForm() {
  const [state, formAction, pending] = useActionState(submitStiRiskCheck, undefined);
  const [active, setActive] = useState(false);
  const [symptoms, setSymptoms] = useState<StiSymptom[]>([]);

  function toggleSymptom(value: StiSymptom, checked: boolean) {
    setSymptoms((prev) => {
      if (value === "none") return checked ? ["none"] : [];
      const withoutNone = prev.filter((s) => s !== "none");
      return checked ? [...withoutNone, value] : withoutNone.filter((s) => s !== value);
    });
  }

  if (state?.success) {
    const codes = state.recommendedScreenCodes ?? [];
    return (
      <Card variant="soft">
        <CardHeader>
          <CardTitle className="text-base">Thanks for checking in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-charcoal-ink/80">
          {codes.length > 0 ? (
            <>
              <p>Based on your answers, it&apos;s worth getting these tests done:</p>
              <ul className="list-disc space-y-1 pl-5">
                {codes.map((code) => (
                  <li key={code}>{RECOMMENDED_SCREEN_LABEL[code] ?? code.replace(/_/g, " ")}</li>
                ))}
              </ul>
              <p className="text-charcoal-ink/60">
                This isn&apos;t a diagnosis — just a nudge based on what you told us. Testing is
                quick, confidential, and a doctor reviews every result.
              </p>
              <Button type="button" size="sm" asChild>
                <a href="#sti-testing-panel">Book these tests</a>
              </Button>
            </>
          ) : (
            <p>
              Nothing here points to needing a test right now. If anything changes — a new
              partner, a new symptom, anything at all — you can always come back and check again.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Sexual health check-in
        </CardTitle>
        <CardDescription>
          A few quick, private questions to help us suggest which tests, if any, are worth
          getting. This stays between you and your care team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-charcoal-ink">
            <input
              type="checkbox"
              name="sexually_active_12mo"
              className="h-4 w-4"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            I&apos;ve been sexually active in the last 12 months
          </label>

          {active && (
            <div className="space-y-5 border-l-2 border-brand-green/20 pl-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-charcoal-ink/80">
                <input type="checkbox" name="new_partner_3mo" className="h-4 w-4" />
                I&apos;ve had a new partner in the last 3 months
              </label>

              <fieldset className="space-y-2">
                <legend className="text-sm text-charcoal-ink">
                  Roughly how many partners in the last 12 months?
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-4">
                  {STI_PARTNER_COUNTS.map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-2.5 py-1.5 text-xs text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
                    >
                      <input
                        type="radio"
                        name="partner_count_12mo"
                        value={value}
                        className="accent-[color:var(--brand-green,#0E7C52)]"
                      />
                      {STI_PARTNER_COUNT_LABEL[value]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm text-charcoal-ink">How often do you use condoms?</legend>
                <div className="grid gap-1.5 sm:grid-cols-3">
                  {STI_CONDOM_USES.map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-2.5 py-1.5 text-xs text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
                    >
                      <input
                        type="radio"
                        name="condom_use"
                        value={value}
                        className="accent-[color:var(--brand-green,#0E7C52)]"
                      />
                      {STI_CONDOM_USE_LABEL[value]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm text-charcoal-ink">
                  Have you noticed any of these recently?
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {STI_SYMPTOMS.map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-charcoal-ink/15 px-2.5 py-1.5 text-xs text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
                    >
                      <input
                        type="checkbox"
                        name="symptoms"
                        value={value}
                        className="h-4 w-4"
                        checked={symptoms.includes(value)}
                        onChange={(event) => toggleSymptom(value, event.target.checked)}
                      />
                      {STI_SYMPTOM_LABEL[value]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-charcoal-ink/80">
                <input type="checkbox" name="prior_sti_diagnosis" className="h-4 w-4" />
                I&apos;ve been diagnosed with an STI before
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-charcoal-ink/80">
                <input type="checkbox" name="partner_diagnosed_sti" className="h-4 w-4" />
                A partner has told me they were diagnosed with an STI
              </label>
            </div>
          )}

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "See what's worth checking"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
