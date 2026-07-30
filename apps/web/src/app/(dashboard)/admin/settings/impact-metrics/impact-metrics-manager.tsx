"use client";

import {
  useImpactMetrics,
  useSetImpactMetricPublished,
  useRecomputeImpactMetrics,
} from "@/lib/queries/impact-metrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ImpactMetricsManager() {
  const { data: metrics, isLoading, isError } = useImpactMetrics();
  const setPublished = useSetImpactMetricPublished();
  const recompute = useRecomputeImpactMetrics();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Impact metrics</CardTitle>
          <CardDescription>
            The refresh runs automatically every night; use this only to see the effect of a
            recent change sooner.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
          {recompute.isPending ? "Recomputing…" : "Recompute now"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load impact metrics.</p>}
        {metrics?.map((metric) => (
          <div
            key={metric.metric_key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 p-3"
          >
            <div>
              <p className="text-sm font-medium text-charcoal-ink">{metric.label}</p>
              <p className="text-xs text-charcoal-ink/60">
                {metric.suppressed || metric.value === null
                  ? "Currently held back (under the 25 privacy floor)"
                  : `Currently showing: ${metric.value}`}
                {metric.computed_at && ` · computed ${new Date(metric.computed_at).toLocaleString()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={metric.is_published ? "green" : "grey"}>
                {metric.is_published ? "Shown on /impact" : "Hidden"}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={setPublished.isPending}
                onClick={() =>
                  setPublished.mutate({ metricKey: metric.metric_key, isPublished: !metric.is_published })
                }
              >
                {metric.is_published ? "Hide" : "Show"}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
