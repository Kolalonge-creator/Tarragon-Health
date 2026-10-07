import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "../../_components/section";
import { loadPublicHealthItem } from "@/lib/marketing/health-library-data";
import { absoluteUrl, SITE } from "@/lib/marketing/site";
import { formatLagosDate, reviewCredit, splitSources } from "@tarragon/shared";

/**
 * The public, shareable page for one Learning Centre item (S55, 9.8). Only an item flagged public, published, in date and
 * clinician reviewed resolves; anything else is a 404. Rendered on every request (no ISR) so an item that passes its review date
 * stops being served at once rather than after a cache window. The signed-in lesson view at /patient/learn/[code] stays gated.
 */
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const item = await loadPublicHealthItem(code);
  if (!item) return { robots: { index: false, follow: false } };
  const url = absoluteUrl(`/health-library/${item.code}`);
  return {
    title: item.title,
    description: item.summary ?? undefined,
    alternates: { canonical: url },
    openGraph: { type: "article", siteName: SITE.name, locale: SITE.locale, title: item.title, description: item.summary ?? undefined, url },
  };
}

export default async function PublicHealthItemPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const item = await loadPublicHealthItem(code);
  if (!item) notFound();

  const credit = reviewCredit({
    clinician_reviewed: true,
    reviewed_by_name: item.reviewedByName,
    reviewed_at: item.reviewedAt,
    source_reference: item.sourceReference,
    next_review_due: item.nextReviewDue,
  });
  const sources = splitSources(item.sourceReference);

  return (
    <Section className="pt-20">
      <article className="mx-auto max-w-2xl">
        <h1 className="font-heading text-3xl font-semibold text-charcoal-ink">{item.title}</h1>
        {item.summary && <p className="mt-3 text-lg text-charcoal-ink/70">{item.summary}</p>}
        <p className="mt-3 text-sm text-charcoal-ink/60">
          {item.estimatedMinutes ? `${item.estimatedMinutes} min read` : null}
          {credit ? ` · Reviewed by ${credit.reviewer} on ${formatLagosDate(credit.reviewedAt)}` : null}
        </p>
        <div className="mt-6 whitespace-pre-line text-base leading-relaxed text-charcoal-ink/90">{item.body}</div>
        {item.nextAction && (
          <div className="mt-8 rounded-lg border border-brand-green/30 bg-soft-sage/40 p-4">
            <p className="text-sm font-semibold text-charcoal-ink">What can I do next?</p>
            <p className="mt-1 text-sm text-charcoal-ink/80">{item.nextAction}</p>
          </div>
        )}
        {sources.length > 0 && (
          <div className="mt-6 text-xs text-charcoal-ink/60">
            <p className="font-semibold">Sources</p>
            <ul className="mt-1 list-disc pl-5">
              {sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-8 text-xs text-charcoal-ink/50">
          This is general information, not a diagnosis. If you are worried about your health, speak to your care team or visit your nearest health facility.
        </p>
        <p className="mt-6">
          <Link href="/signup" className="text-sm font-medium text-brand-green underline">
            Get care that stays with you
          </Link>
        </p>
      </article>
    </Section>
  );
}
