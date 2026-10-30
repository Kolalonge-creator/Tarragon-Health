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

/**
 * A list a partner console could not read. Shown in place of the manager, so no
 * "No claims yet" or "No staff yet" is left on screen for a failed read. Nothing
 * has been removed; the person is told to refresh, not to re-enter anything.
 */
export function ListUnavailable({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <LoadFailure>
          {title} could not be loaded just now. Nothing has been removed. Refresh the page to try again before adding
          or changing anything.
        </LoadFailure>
      </CardContent>
    </Card>
  );
}
