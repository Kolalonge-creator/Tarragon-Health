import Link from "next/link";
import { t } from "@tarragon/i18n";
import { Section } from "../../_components/section";

/** The calm 404 for a shared link that no longer resolves (unpublished, past its review date, withdrawn or mistyped). */
export default function SharedArticleNotFound() {
  return (
    <Section className="pt-24">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="font-heading text-2xl font-bold text-charcoal-ink">{t("learn.share.notfound_title")}</h1>
        <p className="mt-3 text-base text-charcoal-ink/70">{t("learn.share.notfound_body")}</p>
        <p className="mt-6">
          <Link href="/" className="text-sm font-medium text-brand-green underline">
            TarragonHealth
          </Link>
        </p>
      </div>
    </Section>
  );
}
