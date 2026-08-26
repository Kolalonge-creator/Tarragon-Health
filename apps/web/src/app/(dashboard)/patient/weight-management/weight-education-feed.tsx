"use client";

import Link from "next/link";
import { useHealthEducationFeed, useMarkContentProgress } from "@/lib/queries/health-education";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Weight-specific slice of the patient's personalised health-education feed
 * (useHealthEducationFeed already ranks by the caller's own conditions/risk
 * and paces via the weekly drip — this just filters to `condition ===
 * "obesity"` client-side rather than introducing a second, differently-typed
 * RPC call). Read-only list with a one-tap "mark as read"; full detail/quiz
 * interaction stays on /patient/learn rather than forking that UI here.
 */
export function WeightEducationFeed({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: feed, isLoading } = useHealthEducationFeed(patientId);
  const markProgress = useMarkContentProgress(patientId, organisationId ?? "");

  const items = (feed ?? []).filter((item) => item.condition === "obesity");

  if (isLoading || items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Learn</CardTitle>
        <Link href="/patient/learn" className="text-xs text-brand-green hover:underline">
          See full library →
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div
            key={item.content_id}
            className="flex items-start justify-between gap-3 rounded-lg border border-charcoal-ink/10 p-3"
          >
            <div className="space-y-1">
              <p className="text-sm font-medium text-charcoal-ink">{item.title}</p>
              {item.summary && (
                <p className="text-xs text-charcoal-ink/60">{item.summary}</p>
              )}
              {item.estimated_minutes && (
                <p className="text-xs text-charcoal-ink/40">{item.estimated_minutes} min read</p>
              )}
            </div>
            {item.status === "understood" ? (
              <Badge variant="green">read</Badge>
            ) : (
              <button
                type="button"
                onClick={() =>
                  markProgress.mutate({ contentId: item.content_id, status: "understood" })
                }
                className="shrink-0 text-xs text-brand-green hover:underline"
              >
                Mark as read
              </button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
