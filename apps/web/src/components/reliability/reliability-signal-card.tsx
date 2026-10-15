import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadMyReliabilitySignal } from "@/lib/reliability/signal";

/**
 * The clinician's own reliability signal (S78c, spec 23.20), shown to them alone on /clinician/my-performance. Advisory wording: it
 * says how their recent work with the queue has gone and what moves it, and never where they stand among colleagues. A failed read
 * says so instead of showing a score of zero.
 */
export async function ReliabilitySignalCard() {
  const result = await loadMyReliabilitySignal();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your reliability signal</CardTitle>
        <CardDescription>
          A guide for you, not a ranking or a verdict on your care. It only nudges which tasks the queue offers you first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-charcoal-ink/80">
        {!result.ok ? (
          <p role="alert">Your reliability signal could not be loaded just now. Nothing is wrong with it; try again shortly.</p>
        ) : (
          <>
            <p>
              <span className="font-heading text-xl font-semibold text-charcoal-ink">{result.data.score === null ? "No score yet" : result.data.score.toFixed(0)}</span>
              {result.data.score === null ? null : <span className="ml-1 text-xs text-charcoal-ink/60">out of 100, over the last {result.data.window_days} days</span>}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              <li>Finished on time: {result.data.completed_on_time}</li>
              <li>Finished late: {result.data.completed_late}</li>
              <li>Claims that ran out: {result.data.claims_expired}</li>
              <li>Handed back: {result.data.handed_back}</li>
            </ul>
            <p className="text-xs text-charcoal-ink/60">
              Finishing a claimed task before its due time keeps this up. Finishing late or letting a claim run out lowers it. Handing a task
              back with a clear reason does not lower it. Only you see this page.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
