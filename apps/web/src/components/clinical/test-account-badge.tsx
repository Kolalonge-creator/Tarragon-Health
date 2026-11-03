import { Badge } from "@/components/ui/badge";

/**
 * INV-13: a test account (`profiles.is_test`) is never a real person, is never
 * counted, and is never a working doctor's case. Every staff screen that names
 * a patient shows this next to the name so nobody triages "First Patient" as
 * if they were real. One component, so the wording and look never drift.
 */
export function TestAccountBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="amber"
      className={className}
      title="A test account. Not a real person; never counted in any figure, and covered by the Chief Medical Officer, not a working doctor."
    >
      Test account
    </Badge>
  );
}
