"use client";

import { useLearningReadiness } from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const LABEL: Record<string, string> = {
  published_items: "Published items",
  published_without_review_date: "Published with no review date (never expire until one is set)",
  published_without_named_reviewer: "Published with no named reviewer",
  published_without_source: "Published with no source",
  published_without_self_care_action: "Published with no self-care step in \"What can I do next?\"",
  draft_placeholders: "Draft placeholders waiting for a clinical author",
  creators_verified: "Verified creators",
  creators_waiting_verification: "Creators waiting for verification",
};

export function ReadinessManager() {
  const { data, isLoading, isError } = useLearningReadiness();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Content readiness</CardTitle>
        <CardDescription>
          New items cannot be published without a named reviewer, a source, a future review date and a self-care step. Items published before
          that rule existed are counted here; setting their dates and details is a clinical content task, not something the platform decides.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the report.</p>}
        {data && (
          <dl className="divide-y divide-charcoal-ink/10">
            {data.map((r) => (
              <div key={r.metric} className="flex items-center justify-between gap-4 py-2 text-sm">
                <dt className="text-charcoal-ink/80">{LABEL[r.metric] ?? r.metric}</dt>
                <dd className="font-semibold tabular-nums">{r.n}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
