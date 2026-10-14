import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COMPLAINT_LABEL, LICENCE_LABEL, PARTNER_KIND_LABEL, breachLabel, type PartnerQuality } from "@/lib/partner-network/model";

const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "Not set");

/**
 * A partner's own view of how it is doing: the score, what drives it, whether it is open to new work and the complaints recorded against it
 * (category and state only, never the staff note). Fair process: a partner sees the same numbers Tarragon acts on.
 */
export function PartnerQualityCard({ q }: { q: PartnerQuality }) {
  const suspended = q.work_state === "suspended";
  return (
    <div className="space-y-4">
      {suspended && (
        <p role="status" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {PARTNER_KIND_LABEL[q.partner_kind]} work is paused: you are not being sent new work. Work already with you is not affected. Contact Tarragon operations to talk it through.
        </p>
      )}
      <Card>
        <CardHeader><CardTitle>How you are doing</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="text-charcoal-ink/60">Score</span><br /><span className="text-xl font-semibold">{q.score === null ? "Not yet worked out" : q.score.toFixed(1)}</span></p>
          <p><span className="text-charcoal-ink/60">New work</span><br /><Badge variant={suspended ? "red" : "green"}>{suspended ? "Paused" : "Open"}</Badge></p>
          <p><span className="text-charcoal-ink/60">Licence</span><br />{LICENCE_LABEL[q.licence_state ?? ""] ?? "Not tracked"} ({dateOf(q.licence_expires_at)})</p>
          {q.partner_kind === "lab" && (
            <p>
              <span className="text-charcoal-ink/60">Results within the {q.turnaround_target_hours ?? "target"} hour target</span><br />
              {q.orders_measured && q.orders_measured > 0 && q.pct_within_target !== null
                ? `${q.pct_within_target}% of ${q.orders_measured} orders (middle time ${q.turnaround_median_hours} hours)`
                : "Not enough orders yet to measure"}
            </p>
          )}
          <p><span className="text-charcoal-ink/60">Complaints upheld in the last 90 days</span><br />{q.complaints_upheld ?? 0} ({q.complaints_open ?? 0} open)</p>
          <p><span className="text-charcoal-ink/60">Last worked out</span><br />{dateOf(q.computed_at)}</p>
        </CardContent>
      </Card>
      {q.breaches.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardContent><ul className="list-disc pl-5 text-sm">{q.breaches.map((b) => <li key={b}>{breachLabel(b)}</li>)}</ul></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Complaints recorded</CardTitle></CardHeader>
        <CardContent>
          {q.complaints.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">None.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {q.complaints.map((c, i) => (
                <li key={i}>{COMPLAINT_LABEL[c.category as keyof typeof COMPLAINT_LABEL] ?? c.category}, opened {c.opened}: {c.state === "open" ? "open" : c.state === "upheld" ? "upheld" : "not upheld"}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
