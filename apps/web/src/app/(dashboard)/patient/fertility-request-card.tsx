"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { requestFertilityAssessment } from "./womens-health-actions";
import { useFertilityAssessmentRequests, useInvalidateWomensHealth } from "@/lib/queries/womens-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatPatientDate } from "@/lib/format-date";
const STATUS_LABEL: Record<string, string> = {
  requested: "Request received",
  education_provided: "Education shared",
  consult_booked: "Consultation booked",
  referred: "Referred to a specialist",
  closed: "Closed",
};

/**
 * Fertility (§44.13): education -> assessment pathway -> laboratory
 * coordination -> specialist referral, without a self-service testing
 * catalogue or a new matching engine (CLAUDE.md guardrail on Phase 2/3
 * work). The patient logs a request; a clinician reviews it, books labs and
 * a referral through the existing clinician-mediated paths, and the status
 * below reflects that — never presented as a prediction or a guarantee.
 */
export function FertilityRequestCard({ patientId }: { patientId: string }) {
  const requests = useFertilityAssessmentRequests(patientId);
  const invalidate = useInvalidateWomensHealth(patientId);
  const [state, formAction, pending] = useActionState(requestFertilityAssessment, undefined);

  useEffect(() => {
    if (state?.success) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  const hasOpenRequest = requests.data?.some((r) => r.status !== "closed");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fertility</CardTitle>
        <CardDescription>
          Fertility assessment involves your history, some tests and, where appropriate, a
          specialist review, never a guaranteed outcome or a certain timeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Link href="/patient/learn" className="text-sm font-medium text-deep-forest dark:text-brand-green-bright underline underline-offset-2">
          Read fertility basics and preconception health
        </Link>

        {requests.data && requests.data.length > 0 && (
          <div className="space-y-1.5">
            {requests.data.map((r) => (
              <p key={r.id} className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                {formatPatientDate(r.created_at)}: {STATUS_LABEL[r.status] ?? r.status.replace(/_/g, " ")}
              </p>
            ))}
          </div>
        )}

        {!hasOpenRequest && (
          <form action={formAction} className="space-y-3 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="trying_duration_months">
                How many months have you been trying to conceive? (optional)
              </Label>
              <Input id="trying_duration_months" name="trying_duration_months" type="number" min={0} className="max-w-32" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="concern_notes">What would you like your care team to know? (optional)</Label>
              <Input id="concern_notes" name="concern_notes" />
            </div>
            {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sending…" : "Request a fertility assessment"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
