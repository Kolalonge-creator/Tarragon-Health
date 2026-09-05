import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What a list card shows when its read failed.
 *
 * The card keeps its own title, so the section stays where the patient expects
 * it instead of disappearing off the page: seeing "Your test requests" with an
 * honest line under it is the difference between "something went wrong" and
 * "I apparently have no tests booked". Calm and specific, no alarm styling.
 *
 * `role="alert"` sits on the card, not on the sentence, so the title comes
 * with it: "Your test requests. We could not load your test requests just
 * now." is the whole message, and which list failed is the half a screen
 * reader user cannot get from the layout. Assertive rather than polite
 * because this replaced a list that was on the page a moment ago; the visual
 * styling stays calm either way.
 */
export function LoadErrorCard({
  title,
  /** Names the thing that didn't load, e.g. "your test requests". */
  what = "this",
  /** One extra sentence where the consequence of the gap is worth spelling out. */
  detail,
}: {
  title: string;
  what?: string;
  detail?: string;
}) {
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          We could not load {what} just now. Please refresh and try again.
        </p>
        {detail && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}
