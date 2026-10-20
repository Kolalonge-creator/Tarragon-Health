import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { formatSeconds } from "@/lib/chain-health/model";
import type { ProviderLayerHealth } from "@/lib/providers/model";

const PROVIDER_NAME: Record<string, string> = { paystack: "Paystack (payments)", zoom: "Zoom (video)", resend: "Resend (email)" };

/**
 * The outside services the chain depends on (payments, video, email): are their messages being taken in and handled, is any service switched
 * off by the circuit breaker, are there money differences nobody has looked at. Counts and seconds only: no webhook body, no patient. English
 * only (staff page). `health` null means the read failed, which is never shown as healthy.
 */
export function ProviderLayerCard({ health }: { health: ProviderLayerHealth | null }) {
  if (!health) {
    return <LoadFailure>The outside services could not be read. That does not mean they are fine. Try again, and tell the platform team if it keeps failing.</LoadFailure>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Outside services <Badge variant={health.status === "ok" ? "green" : "amber"} className="ml-2">{health.status === "ok" ? "Working" : "Needs a look"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {health.reasons.length === 0 ? (
          <p>Every message from Paystack, Zoom and Resend that arrived has been handled, no service is switched off, and no money difference is overdue.</p>
        ) : (
          <ul className="list-disc pl-5">{health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr><th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Service</th><th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Waiting to be handled</th><th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Longest wait</th><th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Gave up</th></tr>
            </thead>
            <tbody>
              {health.inbox.by_provider.length === 0 ? (
                <tr><td className="px-3 py-2" colSpan={4}>No message from any service has been recorded yet.</td></tr>
              ) : (
                health.inbox.by_provider.map((p) => (
                  <tr key={p.provider}>
                    <td className="px-3 py-2">{PROVIDER_NAME[p.provider] ?? p.provider}</td>
                    <td className="px-3 py-2">{p.open}</td>
                    <td className="px-3 py-2">{p.open === 0 ? "none" : formatSeconds(p.oldest_open_seconds)}</td>
                    <td className="px-3 py-2">{p.dead}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p>
          A message that has waited more than {formatSeconds(health.inbox.stale_after_seconds)} has outlasted any retry, so something is not draining the inbox.
          Switched off by the circuit breaker: {health.breakers.open}. Money differences open: {health.reconciliation.open_breaks}, of which {health.reconciliation.older_than_limit} are older than {health.reconciliation.limit_hours} hours.
          Payout ledger entries needing finance: {health.payout_postings.failed + health.payout_postings.skipped}.
        </p>
        <p className="text-charcoal-ink/60">Messages that failed their signature check in the last day: {health.inbox.rejected_24h} (shown, not counted as a fault). Details are on the Providers board.</p>
      </CardContent>
    </Card>
  );
}
