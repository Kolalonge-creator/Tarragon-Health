import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "../../_components/section";
import { CtaBand } from "../../_components/cta-band";
import { RESOURCE_ARTICLES, RESOURCE_DISCLAIMER } from "../../_content/resources";
import { loadResourceArticle, loadResourceArticles } from "@/lib/marketing/resources-data";
import { absoluteUrl, SITE, SITE_URL } from "@/lib/marketing/site";
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
    author: { "@type": "Organization", name: SITE.name, url: SITE_URL },
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

  return (
    <>
      <script
        type="application/ld+json"
        // Server-rendered from admin-authored copy + our own fixed fields;
        // no user input reaches this string, safe to inline.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Section className="pt-20">
        <article className="mx-auto max-w-2xl">
          <Link href="/resources" className="text-sm text-brand-green hover:underline">
            ← All resources
          </Link>
          <ResourceThumbnail
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
          <p className="mt-4 text-xs text-charcoal-ink/50">
            {isReviewed
              ? `Medically reviewed by ${article.reviewedByName} on ${new Date(
                  article.reviewedAt as string
                ).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}`
              : "By the TarragonHealth editorial team"}
          </p>
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
          <p className="mt-10 rounded-xl border border-charcoal-ink/10 bg-soft-sage/50 p-4 text-sm text-charcoal-ink/70">
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
