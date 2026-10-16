import { t } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface UpcomingHandover {
  patientId: string;
  name: string;
  birthday18: string;
}

const when = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/** A guardian's heads-up that a dependant is about to turn 18 and the profile will become theirs (v5 1.18). */
export function HandoverGuardianCard({ items }: { items: UpcomingHandover[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <Card key={item.patientId}>
          <CardHeader>
            <CardTitle as="h2">{t("handover.guardian.title", "en", { name: item.name, date: when(item.birthday18) })}</CardTitle>
            <CardDescription>{t("handover.guardian.body")}</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ))}
    </div>
  );
}
