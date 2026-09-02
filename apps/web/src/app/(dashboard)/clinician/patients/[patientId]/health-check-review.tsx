"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { completeHealthCheckReview } from "./health-check-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Doctor "Review & communicate" control for the annual Health Check
 * (AHC pathway §5 stage 4). Gated server-side on a current red-flag
 * attestation (§26). `reviewedAt` plus `children` (the caller's
 * <ReviewedResultLine reviewedByKey="staff" />) show existing attribution —
 * the single shared null-gated component, not a hand-rolled name string.
 */
export function HealthCheckReview({
  patientId,
  reviewedAt,
  children,
}: {
  patientId: string;
  reviewedAt: string | null;
  children?: React.ReactNode;
}) {
  const action = completeHealthCheckReview.bind(null, patientId);
  const [state, formAction, pending] = useActionState(action, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Health check: review &amp; communicate</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {reviewedAt && (
          <div className="space-y-1">
            <p className="text-charcoal-ink/70">
              This year&apos;s check is completed ·{" "}
              {new Date(reviewedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
            {children}
          </div>
        )}
        <form action={formAction} className="space-y-2">
          <Textarea
            name="summary"
            required
            rows={3}
            placeholder="Summary for the patient: what the check found and the plan ahead."
          />
          <Button type="submit" disabled={pending} variant={reviewedAt ? "outline" : "default"}>
            {pending ? "Saving…" : reviewedAt ? "Update review" : "Complete health check"}
          </Button>
        </form>
        {state?.error && <p className="text-red-600">{state.error}</p>}
        {state?.success && <p className="text-brand-green">Health check completed.</p>}
      </CardContent>
    </Card>
  );
}
