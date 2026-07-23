import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "../../_components/section";
import { CtaBand } from "../../_components/cta-band";
import { RESOURCE_ARTICLES, RESOURCE_DISCLAIMER } from "../../_content/resources";
import { loadResourceArticle } from "@/lib/marketing/resources-data";
import { absoluteUrl, SITE, SITE_URL } from "@/lib/marketing/site";

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
  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: absoluteUrl(`/resources/${article.slug}`) },
    openGraph: {
      type: "article",
      title: article.title,
      description: article.description,
      url: absoluteUrl(`/resources/${article.slug}`),
      ...(article.publishedAt ? { publishedTime: article.publishedAt } : {}),
      ...(article.updatedAt ? { modifiedTime: article.updatedAt } : {}),
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

  const isReviewed = Boolean(article.reviewedByName && article.reviewedAt);
  const url = absoluteUrl(`/resources/${article.slug}`);

  // MedicalWebPage carries the E-E-A-T signals search engines look for on
  // health content (reviewedBy/lastReviewed) — only emitted when a real
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
        // Server-rendered from admin-authored copy + our own fixed fields —
        // no user input reaches this string, safe to inline.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Section className="pt-20">
        <article className="mx-auto max-w-2xl">
          <Link href="/resources" className="text-sm text-brand-green hover:underline">
            ← All resources
          </Link>
          <p className="mt-6 text-xs font-medium uppercase tracking-wide text-deep-forest">
            {article.category} · {article.readMinutes} min read
          </p>
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
            {article.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
                  {section.heading}
                </h2>
                {section.paragraphs.map((p, i) => (
                  <p key={i} className="mt-3 leading-relaxed text-charcoal-ink/80">
                    {p}
                  </p>
                ))}
              </section>
            ))}
          </div>
          <p className="mt-10 rounded-xl border border-charcoal-ink/10 bg-soft-sage/50 p-4 text-sm text-charcoal-ink/70">
            {RESOURCE_DISCLAIMER}
          </p>
        </article>
      </Section>
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
