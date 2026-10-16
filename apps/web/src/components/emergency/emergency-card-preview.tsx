import { t } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmergencyClinicalFacts } from "@/lib/emergency/card";
import { NOT_SHARED_TEXT, type CardField } from "@/lib/emergency/field-choices";

/**
 * S47d: the person sees what a stranger will see, line by line, with their own choices already applied. `facts` is the OUTPUT of applyCardFieldChoices, the same
 * value the printed card and the live link are built from, so this can never show more or less than the card does. A line the person withheld says so in the same
 * words the card uses.
 */
export function EmergencyCardPreview({ facts, hidden }: { facts: EmergencyClinicalFacts; hidden: readonly CardField[] }) {
  const isHidden = (f: CardField) => hidden.includes(f);
  const rows: { label: string; value: string }[] = [
    { label: "Blood", value: isHidden("blood") ? NOT_SHARED_TEXT : facts.blood ? [facts.blood.blood_group, facts.blood.genotype].filter(Boolean).join(" · ") || "Not recorded" : "Not recorded" },
    {
      label: "Allergies",
      value: isHidden("allergies") ? NOT_SHARED_TEXT : facts.allergies.length > 0 ? facts.allergies.map((a) => a.allergen).join(", ") : "None recorded",
    },
    {
      label: "Current medicines",
      value: isHidden("medications")
        ? NOT_SHARED_TEXT
        : [
            facts.medications.length > 0 ? facts.medications.map((m) => m.drug_name).join(", ") : facts.medicines_not_shown ? "" : "None recorded",
            facts.medicines_not_shown && facts.medicines_not_shown > 0
              ? t(facts.medicines_not_shown === 1 ? "ecf.medicines_not_shown_one" : "ecf.medicines_not_shown_many", "en", { count: String(facts.medicines_not_shown) })
              : "",
          ]
            .filter(Boolean)
            .join(" "),
    },
    {
      label: "Ongoing conditions",
      value: isHidden("conditions") ? NOT_SHARED_TEXT : facts.conditions.length > 0 ? facts.conditions.map((c) => c.replace(/_/g, " ")).join(", ") : "None recorded",
    },
    {
      label: "Emergency contact",
      value: isHidden("emergency_contact") ? NOT_SHARED_TEXT : facts.emergency_contact?.name ? facts.emergency_contact.name : "None recorded",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("ecf.preview_title")}</CardTitle>
        <CardDescription>{t("ecf.preview_help")}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{r.label}</dt>
              <dd className="text-charcoal-ink dark:text-night-ink">{r.value}</dd>
            </div>
          ))}
          {(isHidden("reproductive") || isHidden("mental_health")) && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">Reproductive and mental health</dt>
              <dd className="text-charcoal-ink dark:text-night-ink">{NOT_SHARED_TEXT}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
