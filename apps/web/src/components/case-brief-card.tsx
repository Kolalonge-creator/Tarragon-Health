"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { generateCaseBriefAction } from "@/lib/case-briefs/actions";

export interface CaseBriefData {
  status: "generated" | "failed";
  summaryText: string | null;
  suggestedActionText: string | null;
  generatedAt: string;
}

// A bare toLocaleString() resolves the server's locale on first render and
// the browser's on hydration -- a real mismatch caught live-verifying this
// component (server "30/07/2026, 13:19:30" vs. client "7/30/2026, 1:19:30
// PM"). Fixed locale, same convention as admin/members/[id]/page.tsx's
// formatDateTime.
function formatGeneratedAt(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Always labelled "AI-drafted" and never styled like ReviewedByDoctor's
 * null-gated attribution -- the two must never be visually confusable. This
 * card sits ABOVE the alert's real data on the page, never replaces it.
 * Shared between the doctor escalation detail page and the clinician
 * worklist -- same mechanism (Claude Haiku, same safety prompt, same
 * fail-open persistence), keyed to the underlying clinician_alert so both
 * surfaces read/write the same brief. Deliberately the same component
 * rather than two near-identical ones, so the "AI-drafted" treatment reads
 * identically everywhere it appears.
 */
export function CaseBriefCard({
  clinicianAlertId,
  initialBrief,
  onGenerated,
}: {
  clinicianAlertId: string;
  initialBrief: CaseBriefData | null;
  /** Called after a successful generate/regenerate, in addition to
   * router.refresh() -- lets a list-based caller (the clinician worklist)
   * refetch its own query instead of relying on a full page refresh. */
  onGenerated?: () => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function generate() {
    setIsPending(true);
    try {
      await generateCaseBriefAction(clinicianAlertId);
      router.refresh();
      onGenerated?.();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card variant="soft">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Case summary</CardTitle>
          <Badge variant="grey">AI-drafted — not yet reviewed</Badge>
        </div>
        <CardDescription>
          A quick summary grounded only in this patient&apos;s recorded data — read it alongside the
          case detail, not instead of it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!initialBrief && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/60">No summary generated yet.</p>
            <Button size="sm" variant="outline" disabled={isPending} onClick={generate}>
              {isPending ? "Generating…" : "Generate summary"}
            </Button>
          </div>
        )}

        {initialBrief?.status === "failed" && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/60">
              Couldn&apos;t generate a summary for this case — the case detail is unaffected.
            </p>
            <Button size="sm" variant="outline" disabled={isPending} onClick={generate}>
              {isPending ? "Retrying…" : "Try again"}
            </Button>
          </div>
        )}

        {initialBrief?.status === "generated" && (
          <div className="space-y-3">
            <p className="text-sm text-charcoal-ink">{initialBrief.summaryText}</p>
            {initialBrief.suggestedActionText && (
              <p className="text-sm text-charcoal-ink">
                <span className="font-medium">Suggested next step: </span>
                {initialBrief.suggestedActionText}
              </p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-charcoal-ink/50">
                Generated {formatGeneratedAt(initialBrief.generatedAt)}
              </p>
              <Button size="sm" variant="outline" disabled={isPending} onClick={generate}>
                {isPending ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
