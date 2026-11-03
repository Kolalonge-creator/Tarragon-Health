import { Check } from "lucide-react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { previewForPermissions, type CirclePreview } from "@tarragon/shared";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

const SEES: Readonly<Record<CirclePreview["sees"][number], MessageKey>> = {
  adherence: "supporterjoin.sees.adherence",
  bp: "supporterjoin.sees.bp",
  appointments: "supporterjoin.sees.appointments",
  digest: "supporterjoin.sees.digest",
};
const CAN: Readonly<Record<CirclePreview["can"][number], MessageKey>> = {
  alert: "supporterjoin.can.alert",
  pay: "supporterjoin.can.pay",
  tasks: "supporterjoin.can.tasks",
  call: "supporterjoin.can.call",
};

/**
 * What the person being invited will be able to see and do, said once and in their own voice ("See Ngozi's weekly blood pressure
 * trend"), built from the real permission list so it can never promise more than the database will show. Used on the signed-out
 * landing and on the signed-in join card.
 */
export function SupporterPermissionList({
  permissions,
  name,
  locale,
  crossOrganisation = false,
  headingLevel: Heading = "h2",
}: {
  permissions: readonly string[];
  name: string;
  locale: Locale;
  crossOrganisation?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  const p = previewForPermissions(permissions);
  const lines: MessageKey[] = [...p.sees.map((s) => SEES[s]), ...p.can.map((c) => CAN[c])];
  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="supporter-permissions-heading" className="space-y-3" data-testid="supporter-permission-list">
      <Heading id="supporter-permissions-heading" className="font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">
        {t("supporterjoin.list_heading", locale)}
      </Heading>
      <ul className="space-y-2.5">
        {lines.map((key) => (
          <li key={key} className="flex items-start gap-2.5 text-sm text-charcoal-ink/85 dark:text-night-ink/85">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green dark:text-brand-green-bright" strokeWidth={2.5} aria-hidden />
            <span>{t(key, locale, { name })}</span>
          </li>
        ))}
      </ul>
      <p className={`text-sm ${MUTED}`}>{t("supporterjoin.never", locale, { name })}</p>
      {crossOrganisation ? <p className={`text-sm ${MUTED}`}>{t("cctools.preview.cross_org", locale)}</p> : null}
      <p className={`text-sm ${MUTED}`}>{t("supporterjoin.control", locale, { name })}</p>
    </section>
  );
}
