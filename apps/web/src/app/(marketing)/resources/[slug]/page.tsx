import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "../../_components/section";
import { CtaBand } from "../../_components/cta-band";
import { DEFAULT_ARTICLE_AUTHOR, RESOURCE_ARTICLES, RESOURCE_DISCLAIMER } from "../../_content/resources";
import { loadResourceArticle, loadResourceArticles } from "@/lib/marketing/resources-data";
import { absoluteUrl, SITE, SITE_URL } from "@/lib/marketing/site";
import { resourceFaqJsonLd } from "@/lib/marketing/resource-faq";
import { ResourceCarousel } from "../../_components/resource-carousel";
import { ResourceThumbnail, resourceThumbnailIcon } from "../../_components/resource-thumbnail";
import { ShareArticleButton } from "../../_components/share-article-button";

// Admin-published articles beyond the static seed list resolve at request
// time; the seed slugs stay statically generated for build-time coverage.
export const dynamicParams = true;
export const revalidate = 300;

export function generateStaticParams() {
  return RESOURCE_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadResourceArticle(slug);
  if (!article) return {};
  const url = absoluteUrl(`/resources/${article.slug}`);
  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: SITE.name,
      locale: SITE.locale,
      title: article.title,
      description: article.description,
      url,
      ...(article.publishedAt ? { publishedTime: article.publishedAt } : {}),
      ...(article.updatedAt ? { modifiedTime: article.updatedAt } : {}),
    },
    // Next replaces the whole resolved twitter object with whatever this
    // segment declares (see pageMetadata's doc comment in lib/marketing/site
    // for the resolver trace) — omitting this entirely, as before, meant the
    // layout's bare {card} object won unchanged and no twitter:title/
    // description ever rendered for an article.
    twitter: {
      card: "summary_large_image",
      site: `@${SITE.twitterHandle}`,
      title: article.title,
      description: article.description,
    },
  };
}

export default async function ResourceArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = await loadResourceArticle(slug);
  if (!article) notFound();

  const allArticles = await loadResourceArticles();
  const related = allArticles.filter(
    (a) => a.category === article.category && a.slug !== article.slug
  );

  const isReviewed = Boolean(article.reviewedByName && article.reviewedAt);
  const url = absoluteUrl(`/resources/${article.slug}`);
  const author = article.authorName?.trim() || DEFAULT_ARTICLE_AUTHOR;
  const references = article.references ?? [];
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Lagos" });

  // MedicalWebPage carries the E-E-A-T signals search engines look for on
  // health content (reviewedBy/lastReviewed); only emitted when a real
  // review record exists, same honesty rule as the visible byline below.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalWebPage",
    "@id": url,
    url,
    headline: article.title,
    name: article.title,
    description: article.description,
    inLanguage: "en",
    ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
    ...(article.updatedAt ? { dateModified: article.updatedAt } : {}),
    author: article.authorName?.trim()
      ? { "@type": "Person", name: article.authorName.trim() }
      : { "@type": "Organization", name: SITE.name, url: SITE_URL },
    ...(references.length > 0
      ? { citation: references.map((r) => ({ "@type": "CreativeWork", name: r.label, url: r.url })) }
      : {}),
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: absoluteUrl(SITE.logoPath) },
    },
    ...(isReviewed
      ? {
          reviewedBy: { "@type": "Person", name: article.reviewedByName },
          lastReviewed: article.reviewedAt,
        }
      : {}),
    disclaimer: RESOURCE_DISCLAIMER,
  };
  // Sections written as questions also go to Google as an FAQ, answered with the same visible text (resource-faq.ts).
  const faqLd = resourceFaqJsonLd(url, article.sections);

  return (
    <>
      <script
        type="application/ld+json"
        // Server-rendered from admin-authored copy + our own fixed fields;
        // no user input reaches this string, safe to inline.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {faqLd ? (
        <script
          type="application/ld+json"
          // Same provenance as jsonLd above: built from the article's own published sections.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }}
        />
      ) : null}
      <Section className="pt-20">
        <article className="mx-auto max-w-2xl">
          <Link href="/resources" className="text-sm text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            <span aria-hidden>←</span> All resources
          </Link>
          <ResourceThumbnail
            category={article.category}
            icon={resourceThumbnailIcon(article)}
            className="mt-6 aspect-[16/7] rounded-2xl"
          />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-deep-forest">
              {article.category} · {article.readMinutes} min read
            </p>
            <ShareArticleButton title={article.title} url={url} />
          </div>
          <h1 className="mt-2 font-heading text-3xl font-bold leading-tight text-charcoal-ink sm:text-4xl">
            {article.title}
          </h1>
          <p className="mt-4 text-lg text-charcoal-ink/70">{article.description}</p>
          {/* Provenance (website Phase 4): every line is shown only when the
              record behind it exists; the reviewer line is null-gated on a
              recorded review, never typed (CLAUDE.md reviewed_by rule). */}
          <dl className="mt-5 grid gap-x-6 gap-y-1 border-y border-mk-border py-4 text-sm text-mk-muted sm:grid-cols-2" data-testid="article-provenance">
            <div className="flex gap-1">
              <dt>Written by</dt>
              <dd className="font-medium text-charcoal-ink">{author}</dd>
            </div>
            {isReviewed ? (
              <div className="flex gap-1">
                <dt>Medically reviewed by</dt>
                <dd className="font-medium text-charcoal-ink">{article.reviewedByName}</dd>
              </div>
            ) : null}
            {article.publishedAt ? (
              <div className="flex gap-1">
                <dt>Published</dt>
                <dd>{date(article.publishedAt)}</dd>
              </div>
            ) : null}
            {isReviewed ? (
              <div className="flex gap-1">
                <dt>Last reviewed</dt>
                <dd>{date(article.reviewedAt as string)}</dd>
              </div>
            ) : article.updatedAt ? (
              <div className="flex gap-1">
                <dt>Last updated</dt>
                <dd>{date(article.updatedAt)}</dd>
              </div>
            ) : null}
            {isReviewed && article.nextReviewAt ? (
              <div className="flex gap-1">
                <dt>Next review due</dt>
                <dd>{date(article.nextReviewAt)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-10 space-y-8">
            {article.sections.map((section, index) => (
              <section key={section.heading}>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-xs font-bold text-brand-green"
                  >
                    {index + 1}
                  </span>
                  <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
                    {section.heading}
                  </h2>
                </div>
                {section.paragraphs.map((p, i) => (
                  <p key={i} className="mt-3 pl-10 leading-relaxed text-charcoal-ink/80">
                    {p}
                  </p>
                ))}
              </section>
            ))}
          </div>
          {references.length > 0 ? (
            <section className="mt-10" aria-labelledby="article-references">
              <h2 id="article-references" className="font-heading text-lg font-semibold text-charcoal-ink">
                References
              </h2>
              <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm text-charcoal-ink/80">
                {references.map((r) => (
                  <li key={r.url}>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand-green underline underline-offset-2">
                      {r.label}
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <p className="mt-10 rounded-xl border border-charcoal-ink/10 bg-soft-sage/50 p-4 text-sm text-charcoal-ink/80">
            {RESOURCE_DISCLAIMER}
          </p>
          <div className="mt-6 flex justify-center">
            <ShareArticleButton title={article.title} url={url} />
          </div>
        </article>
      </Section>
      {related.length > 0 ? (
        <Section>
          <ResourceCarousel
            title={`Explore more ${article.category} resources`}
            articles={related}
          />
        </Section>
      ) : null}
      <Section variant="sage">
        <CtaBand
          variant="gradient"
          title="Want this managed, not just explained?"
          description="A care team that tracks your numbers, schedules your screenings, and follows up when something needs attention."
          primaryHref={article.relatedHref}
          primaryLabel={article.relatedLabel}
          secondaryHref="/signup"
          secondaryLabel="Start free"
        />
      </Section>
    </>
  );
}
