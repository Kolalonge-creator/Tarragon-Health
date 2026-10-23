import Link from "next/link";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AlertTemplateProps {
  /** What we noticed: one short sentence, shown as the card title. */
  noticed: string;
  /** What it may mean, in one line. */
  meaning: string;
  /** One step to take. */
  step: string;
  /** True only for a real clinical alert (a danger sign). A reminder, a device state or a tip is never clinical, so it stays green. */
  clinical?: boolean;
  /** True for "go now" cards: the step comes first, larger and bold, and the message link is left out so nothing sits beside the emergency instruction. */
  urgent?: boolean;
  /** Where the "Message your care team" button goes. Defaults to Messages. Pass null to leave the button out. */
  messageHref?: string | null;
}

/**
 * The standard alert card (UI-C change 12): what we noticed, what it may mean, one step, and a button to message your care team.
 * No exclamation marks, no "WARNING", no fear words; packages/shared/src/copy-lint/alert-tone-lint.test.ts holds that, and holds
 * that red styling stays on clinical alerts. The words carry the meaning, not the colour.
 */
export function AlertTemplate({ noticed, meaning, step, clinical = false, urgent = false, messageHref = "/patient/messages" }: AlertTemplateProps) {
  return (
    <Card
      role={clinical ? "alert" : "region"}
      aria-label={noticed}
      className={clinical ? "border-red-200 dark:border-red-500/30" : "border-brand-green/30"}
    >
      <CardContent className="space-y-3 pt-5">
        <h3 className="text-base font-semibold text-charcoal-ink dark:text-night-ink">{noticed}</h3>
        {urgent ? <p className="text-lg font-extrabold text-charcoal-ink dark:text-night-ink">{step}</p> : null}
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60">{t("alerttpl.label.meaning")}</dt>
            <dd className="text-charcoal-ink dark:text-night-ink">{meaning}</dd>
          </div>
          {urgent ? null : (
            <div>
              <dt className="text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60">{t("alerttpl.label.step")}</dt>
              <dd className={cn("font-medium text-charcoal-ink dark:text-night-ink")}>{step}</dd>
            </div>
          )}
        </dl>
        {messageHref && !urgent ? (
          <Button asChild variant="outline">
            <Link href={messageHref}>{t("alerttpl.message_care_team")}</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
