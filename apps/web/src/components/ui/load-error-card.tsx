import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What a list card shows when its read failed.
 *
 * The card keeps its own title, so the section stays where the patient expects
 * it instead of disappearing off the page: seeing "Your test requests" with an
 * honest line under it is the difference between "something went wrong" and
 * "I apparently have no tests booked". Calm and specific, no alarm styling.
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
    <Card>
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
