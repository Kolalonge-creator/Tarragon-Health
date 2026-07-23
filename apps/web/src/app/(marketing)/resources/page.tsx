import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const metadata: Metadata = {
  title: "Health resources — plain answers to real questions",
  description:
    "Clear, honest articles on blood pressure, diabetes, weight, cholesterol and screening — written for Nigerians, in plain language.",
};

// Content is admin-managed in the DB — re-render every 5 minutes so a newly
// published article appears without a deploy.
export const revalidate = 300;

export default async function ResourcesPage() {
  const articles = await loadResourceArticles();
  const categories = [...new Set(articles.map((a) => a.category))];

  return (
    <>
      <Section className="pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">
            Health, in plain language
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Straight answers to the questions people actually ask — no jargon, no fear, no
            miracle cures. Just what the evidence supports and what to do next.
          </p>
        </div>
      </Section>
      {categories.map((category) => (
        <Section key={category}>
          <SectionHeading title={category} />
          <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
            {articles
              .filter((a) => a.category === category)
              .map((article) => (
                <Link
                  key={article.slug}
                  href={`/resources/${article.slug}`}
                  className="group rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm transition hover:border-brand-green/40 hover:shadow-md"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-deep-forest">
                    {article.readMinutes} min read
                  </p>
                  <h3 className="mt-2 font-heading text-lg font-semibold text-charcoal-ink group-hover:text-brand-green">
                    {article.title}
                  </h3>
                  <p className="mt-2 text-sm text-charcoal-ink/70">{article.description}</p>
                </Link>
              ))}
          </div>
        </Section>
      ))}
      <Section variant="sage">
        <CtaBand
          variant="gradient"
          title="Reading is a start — monitoring is the difference"
          description="Tarragon turns knowing into doing: your readings tracked, your screenings scheduled, a care team watching the trend."
          primaryHref="/signup"
          primaryLabel="Start free"
          secondaryHref="/services"
          secondaryLabel="See how it works"
        />
      </Section>
    </>
  );
}
