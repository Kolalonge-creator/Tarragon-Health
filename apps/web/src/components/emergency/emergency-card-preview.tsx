import Link from "next/link";
import { t } from "@tarragon/i18n";
import type { EmergencyClinicalFacts } from "@/lib/emergency/card";
import { NOT_SHARED_TEXT, type CardField } from "@/lib/emergency/field-choices";

/**
 * S47d: the person sees what a stranger will see, line by line, with their own choices already applied. `facts` is the OUTPUT of applyCardFieldChoices, the same
 * value the printed card and the live link are built from, so this can never show more or less than the card does. A line the person withheld says so in the same
 * words the card uses.
 *
 * Laid out like a lock screen card so the person sees it the way a first responder would. It is a read-only rendering of facts the page already loaded. A line
 * with nothing in it says "Not added yet" and links to where it is added. It never invents a value, and it never shows "None" for a detail that was only withheld.
 */
export function EmergencyCardPreview({ facts, hidden }: { facts: EmergencyClinicalFacts; hidden: readonly CardField[] }) {
  const isHidden = (f: CardField) => hidden.includes(f);

  type Row = { label: string; field: CardField; value: string | null; addHref: string };

  const blood = facts.blood ? [facts.blood.blood_group, facts.blood.genotype].filter(Boolean).join(" · ") : "";
  const medicines = [
    facts.medications.length > 0 ? facts.medications.map((m) => m.drug_name).join(", ") : "",
    facts.medicines_not_shown && facts.medicines_not_shown > 0
      ? t(facts.medicines_not_shown === 1 ? "ecf.medicines_not_shown_one" : "ecf.medicines_not_shown_many", "en", { count: String(facts.medicines_not_shown) })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const contact = facts.emergency_contact?.name ? [facts.emergency_contact.name, facts.emergency_contact.phone].filter(Boolean).join(" · ") : "";

  const rows: Row[] = [
    { label: "Blood group and genotype", field: "blood", value: blood || null, addHref: "#blood-attestation" },
    { label: "Allergies", field: "allergies", value: facts.allergies.length > 0 ? facts.allergies.map((a) => a.allergen).join(", ") : null, addHref: "/patient/profile" },
    { label: "Ongoing conditions", field: "conditions", value: facts.conditions.length > 0 ? facts.conditions.map((c) => c.replace(/_/g, " ")).join(", ") : null, addHref: "/patient/profile" },
    { label: "Current medicines", field: "medications", value: medicines || null, addHref: "/patient/medications" },
    { label: "Emergency contact", field: "emergency_contact", value: contact || null, addHref: "/patient/profile" },
  ];

  return (
    <section aria-labelledby="emergency-card-preview-title" className="space-y-2">
      <div>
        <h2 id="emergency-card-preview-title" className="text-base font-semibold text-charcoal-ink dark:text-night-ink">
          {t("ecf.preview_title")}
        </h2>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("ecf.preview_help")}</p>
      </div>
      <div
        className="mx-auto w-full max-w-sm rounded-3xl border border-charcoal-ink/15 bg-white p-4 shadow-sm dark:border-night-ink/20 dark:bg-night-card"
        data-testid="emergency-card-preview"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">Emergency card</p>
        <p className="mt-1 text-lg font-semibold text-charcoal-ink dark:text-night-ink" data-testid="preview-name">
          {facts.full_name ?? "Name not recorded"}
        </p>
        <dl className="mt-3 space-y-2.5 text-sm">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{r.label}</dt>
              <dd className="text-charcoal-ink dark:text-night-ink">
                {isHidden(r.field) ? (
                  NOT_SHARED_TEXT
                ) : r.value ? (
                  r.value
                ) : (
                  <span className="text-charcoal-ink/70 dark:text-night-ink/70">
                    Not added yet.{" "}
                    <Link href={r.addHref} className="font-medium text-brand-green underline-offset-2 hover:underline dark:text-brand-green-bright">
                      Add it
                    </Link>
                  </span>
                )}
              </dd>
            </div>
          ))}
          {(isHidden("reproductive") || isHidden("mental_health")) && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">Reproductive and mental health</dt>
              <dd className="text-charcoal-ink dark:text-night-ink">{NOT_SHARED_TEXT}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
