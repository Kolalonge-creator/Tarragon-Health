import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "../../_components/section";
import { CtaBand } from "../../_components/cta-band";
import {
  RESOURCE_ARTICLES,
  RESOURCE_DISCLAIMER,
  getResourceArticle,
} from "../../_content/resources";

export function generateStaticParams() {
  return RESOURCE_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getResourceArticle(slug);
  if (!article) return {};
  return {
    title: article.title,
    description: article.description,
  };
}

export default async function ResourceArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getResourceArticle(slug);
  if (!article) notFound();

  return (
    <>
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
            By the TarragonHealth editorial team
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
