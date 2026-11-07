"use client";

import { useHealthEducationAnalytics } from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

// The thumbs headings were emoji, which a screen reader reads out as "thumbs up sign"; words say what they count.
const COLUMNS: DataTableColumn[] = [
  { header: "Title", sortable: true, className: "max-w-xs" },
  ...["Views", "Understood", "Needs review"].map((header) => ({ header, sortable: true, defaultDir: "desc" as const, align: "right" as const })),
  { header: "Avg quiz score", sortable: true, defaultDir: "desc", align: "right" },
  ...["Helpful", "Not helpful", "Unclear", "Want more", "Reported wrong"].map((header) => ({ header, sortable: true, defaultDir: "desc" as const, align: "right" as const })),
];

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
        {rows && (
          // Arrives most-viewed first; that order is kept until a heading is pressed.
          <DataTable
            caption="Content performance"
            columns={COLUMNS}
            rows={rows.map((row) => {
              const quiz = row.avg_check_score !== null && row.avg_check_total !== null && Number(row.avg_check_total) > 0
                ? Number(row.avg_check_score) / Number(row.avg_check_total)
                : null;
              return {
                key: row.content_id,
                searchText: row.title,
                // The quiz score sorts as a share of the total, since items have quizzes of different lengths.
                sort: [row.title, row.view_count, row.understood_count, row.needs_review_count, quiz, row.helpful_count, row.not_helpful_count, row.unclear_count, row.want_more_count, row.report_incorrect_count],
                cells: [
                  <span key="t" className="block truncate font-medium text-charcoal-ink">
                    {row.title}
                    {!row.is_active && <Badge variant="grey" className="ml-2">Hidden</Badge>}
                  </span>,
                  row.view_count,
                  row.understood_count,
                  row.needs_review_count,
                  row.avg_check_score !== null && row.avg_check_total !== null
                    ? `${Number(row.avg_check_score).toFixed(1)} / ${Number(row.avg_check_total).toFixed(1)}`
                    : "—",
                  row.helpful_count,
                  row.not_helpful_count,
                  row.unclear_count,
                  row.want_more_count,
                  row.report_incorrect_count > 0 ? <Badge key="r" variant="amber">{row.report_incorrect_count}</Badge> : <span key="r" className="text-charcoal-ink/40">0</span>,
                ],
              };
            })}
            searchLabel="Search content"
            emptyMessage="No data yet."
            noun={{ one: "item", many: "items" }}
          />
        )}
      </CardContent>
    </Card>
  );
}
