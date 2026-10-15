import { t } from "@tarragon/i18n";

/**
 * The calm note shown in place of a creator series lesson for someone who is not a Member (a members-only perk, no payment logic
 * here: the server decides who is locked and withholds the body). It names the creator and says what it is, with no pressure and
 * no price. The title and the credit stay visible around it.
 */
export function MembersOnlyPrompt({ creatorName }: { creatorName?: string | null }) {
  return (
    <section
      aria-label={t("learn.members.title")}
      className="space-y-1 rounded-xl border border-brand-green/25 bg-brand-green/5 p-3 text-sm dark:border-brand-green-bright/30 dark:bg-brand-green/10"
      data-testid="members-only-prompt"
    >
      <p className="font-semibold text-charcoal-ink dark:text-night-ink">{t("learn.members.title")}</p>
      {creatorName ? <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.members.by", "en", { name: creatorName })}</p> : null}
      <p className="text-charcoal-ink/85 dark:text-night-ink/85">{t("learn.members.body")}</p>
    </section>
  );
}
