"use client";

import { useLearningSearchGaps } from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
        {data && data.length === 0 && <p className="text-sm text-charcoal-ink/60">Nothing to show yet. The log is switched off until the founder and the DPO confirm it (see the open question on the zero-result search log), and a phrase shows only after enough searches.</p>}
        {data && data.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-charcoal-ink/10 text-xs text-charcoal-ink/50">
                <th className="py-2 pr-3">Phrase</th>
                <th className="py-2 pr-3">Searches</th>
                <th className="py-2 pr-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.query_norm} className="border-b border-charcoal-ink/5">
                  <td className="py-2 pr-3 font-medium">{g.query_norm}</td>
                  <td className="py-2 pr-3 tabular-nums">{g.hit_count}</td>
                  <td className="py-2 pr-3 text-charcoal-ink/60">{g.last_seen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
