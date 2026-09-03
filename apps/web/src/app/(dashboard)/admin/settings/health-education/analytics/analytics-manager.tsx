"use client";

import { useHealthEducationAnalytics } from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** docs Module 20 §20.18 — per-content view/completion/quiz/feedback rollup. */
export function AnalyticsManager() {
  const { data: rows, isLoading, isError } = useHealthEducationAnalytics();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Content performance</CardTitle>
        <CardDescription>
          Per-item view/completion/quiz/feedback counts, most-viewed first. Correlating this with
          care-plan adherence is deliberately not attempted here. See the migration&apos;s
          comment for why.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load analytics.</p>}
        {rows && rows.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No data yet.</p>
        )}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Views</th>
                  <th className="py-2 pr-3">Understood</th>
                  <th className="py-2 pr-3">Needs review</th>
                  <th className="py-2 pr-3">Avg quiz score</th>
                  <th className="py-2 pr-3">👍</th>
                  <th className="py-2 pr-3">👎</th>
                  <th className="py-2 pr-3">Unclear</th>
                  <th className="py-2 pr-3">Want more</th>
                  <th className="py-2 pr-3">Reported wrong</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.content_id} className="border-b border-charcoal-ink/5">
                    <td className="max-w-xs truncate py-2 pr-3 font-medium text-charcoal-ink">
                      {row.title}
                      {!row.is_active && (
                        <Badge variant="grey" className="ml-2">
                          Hidden
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">{row.view_count}</td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">{row.understood_count}</td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">{row.needs_review_count}</td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">
                      {row.avg_check_score !== null && row.avg_check_total !== null
                        ? `${Number(row.avg_check_score).toFixed(1)} / ${Number(row.avg_check_total).toFixed(1)}`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">{row.helpful_count}</td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">{row.not_helpful_count}</td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">{row.unclear_count}</td>
                    <td className="py-2 pr-3 text-charcoal-ink/70">{row.want_more_count}</td>
                    <td className="py-2 pr-3">
                      {row.report_incorrect_count > 0 ? (
                        <Badge variant="amber">{row.report_incorrect_count}</Badge>
                      ) : (
                        <span className="text-charcoal-ink/40">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
