"use client";

import { useLearningSearchGaps } from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";

export function SearchGapsManager() {
  const { data, isLoading, isError } = useLearningSearchGaps();
  return (
    <Card>
      <CardHeader>
        <CardTitle>What patients searched for and did not find</CardTitle>
        <CardDescription>
          Anonymous: a phrase and a count, with no person, device or time of day. Phrases that look like a number or an email address are never
          kept, a phrase appears here only after enough separate searches, and rows are deleted after the retention period.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the report.</p>}
        {data && (
          <DataTable
            caption="Searches that found nothing"
            columns={[
              { header: "Phrase", sortable: true },
              { header: "Searches", sortable: true, defaultDir: "desc", align: "right" },
              { header: "Last seen", sortable: true, defaultDir: "desc" },
            ]}
            rows={data.map((g) => ({
              key: g.query_norm,
              searchText: g.query_norm,
              sort: [g.query_norm, g.hit_count, g.last_seen],
              cells: [<span key="q" className="font-medium">{g.query_norm}</span>, g.hit_count, <span key="seen" className="text-charcoal-ink/60">{g.last_seen}</span>],
            }))}
            searchLabel="Search phrases"
            initialSort={{ column: 1, dir: "desc" }}
            emptyMessage="Nothing to show yet. The log is switched off until the founder and the DPO confirm it (see the open question on the zero-result search log), and a phrase shows only after enough searches."
            noun={{ one: "phrase", many: "phrases" }}
          />
        )}
      </CardContent>
    </Card>
  );
}
