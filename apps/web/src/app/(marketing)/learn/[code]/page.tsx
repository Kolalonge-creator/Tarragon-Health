import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { t } from "@tarragon/i18n";
import { buildTrustLine } from "@tarragon/shared";
import { Section } from "../../_components/section";
import { loadSharedArticle as loadSharedArticleUncached } from "@/lib/marketing/learn-data";
import { absoluteUrl } from "@/lib/marketing/site";
import { ShareLessonButtons } from "@/components/learning/share-lesson-buttons";

// One database read per request even though both generateMetadata and the page need the article.
const loadSharedArticle = cache(loadSharedArticleUncached);

// A shared link is for one reader, never listed or indexed. It is rendered per request so an article that expires or is
// withdrawn stops resolving at once instead of waiting for a cache to turn over.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const article = await loadSharedArticle(code);
  return {
    title: article ? article.title : t("learn.share.notfound_title"),
    description: article?.summary ?? t("learn.share.disclaimer"),
    robots: { index: false, follow: false },
  };
}

export default async function SharedArticlePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const article = await loadSharedArticle(code);
  if (!article) notFound();

  const trust = buildTrustLine({
    reviewedByName: article.reviewedByName,
    reviewedAt: article.reviewedAt,
    nextReviewDue: article.nextReviewDue,
    sourceReference: article.sourceReference,
    evidenceSource: article.evidenceSource,
    creatorName: article.creatorName,
  });

  return (
    <Section className="pt-20">
      <article className="mx-auto max-w-2xl">
        <h1 className="font-heading text-3xl font-bold leading-tight text-charcoal-ink sm:text-4xl">{article.title}</h1>
        {article.summary && <p className="mt-4 text-lg text-charcoal-ink/70">{article.summary}</p>}
        <div className="mt-4 space-y-0.5 text-xs text-charcoal-ink/65" data-testid="trust-line">
          {trust.author && <p>{t("learn.trust.author", "en", { name: trust.author })}</p>}
          {trust.reviewedBy && <p>{t("learn.trust.reviewed_by", "en", { name: trust.reviewedBy })}</p>}
          {trust.reviewedOn && <p>{t("learn.trust.reviewed_on", "en", { date: trust.reviewedOn })}</p>}
          {trust.nextReview && <p>{t("learn.trust.next_review", "en", { date: trust.nextReview })}</p>}
          {trust.sources && <p>{t("learn.trust.sources", "en", { sources: trust.sources })}</p>}
        </div>
        <div className="mt-6 whitespace-pre-line text-base leading-relaxed text-charcoal-ink/90">{article.body}</div>
        {article.selfCareAction && (
          <section className="mt-6 rounded-xl bg-brand-green/5 p-4">
            <h2 className="text-sm font-semibold text-charcoal-ink">{t("learn.next.title")}</h2>
            <p className="mt-1 text-sm">
              <span className="font-medium">{t("learn.next.self_care")}: </span>
              {article.selfCareAction}
            </p>
          </section>
        )}
        <aside role="note" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-testid="urgent-help-box">
          <p className="font-semibold">{t("learn.urgent.title")}</p>
          <p className="mt-1">{t("learn.urgent.body")}</p>
        </aside>
        <p className="mt-6 text-xs text-charcoal-ink/65">{t("learn.share.disclaimer")}</p>
        <div className="mt-4">
          <ShareLessonButtons title={article.title} url={absoluteUrl(`/learn/${article.code}`)} />
        </div>
        <p className="mt-6">
          <Link href="/" className="text-sm text-brand-green underline">
            TarragonHealth
          </Link>
        </p>
      </article>
    </Section>
  );
}
