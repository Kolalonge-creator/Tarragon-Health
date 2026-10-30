import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";

/**
 * What an institution dashboard card shows when its own read failed.
 *
 * Used in place of the card, never beside it, so no zero or empty state is left
 * on screen to be read as "nothing to report". An employer or insurer reading
 * "0% vaccinated" or "no contract" acts on it; "could not be loaded" they do not.
 */
export function SectionUnavailable({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <LoadFailure>
          {title} could not be loaded just now. The figures are unknown, not zero. Refresh the page to try again.
        </LoadFailure>
      </CardContent>
    </Card>
  );
}
