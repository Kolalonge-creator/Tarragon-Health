import type { Metadata } from "next";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import {
  TIER_COPY,
  getPublishedCommitments,
  humaniseMinutes,
} from "@/lib/marketing/accountability-data";
import { pageMetadata } from "@/lib/marketing/site";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = pageMetadata({
  title: "How we hold ourselves accountable",
  description:
    "How fast TarragonHealth responds when something looks wrong, who signed off on those commitments, where your health data is stored, and who can see it.",
  path: MARKETING_ROUTES.accountability,
});

export const revalidate = 300;

export default async function AccountabilityPage() {
  const published = await getPublishedCommitments();

  return (
    <>
      <Section className="pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">
            How we hold ourselves accountable
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Trusting a new company with your family&apos;s health is a real thing to ask. These are
            the commitments we have written down, who put their name to them, and where your
            information actually sits.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Response times
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              What happens when something looks wrong
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              These times come straight from the version our Clinical Director signed. If that
              document changes, this page changes with it, and we won&apos;t quote a number
              nobody has approved.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "response-clock",
              imageAlt: "A deadline attached to every flagged reading",
            }}
          />
        </div>

        {published ? (
          <div className="mx-auto max-w-3xl space-y-4">
            {published.commitments.map((commitment) => {
              const copy = TIER_COPY[commitment.tier];
              return (
                <div
                  key={commitment.tier}
                  className="rounded-2xl border border-charcoal-ink/10 bg-white p-6"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-heading text-lg font-semibold text-charcoal-ink">
                      {copy?.label ?? commitment.tier}
                    </p>
                    <p className="font-heading text-lg font-semibold text-brand-green">
                      within {humaniseMinutes(commitment.ceilingMinutes)}
                    </p>
                  </div>
                  {copy?.meaning && (
                    <p className="mt-2 text-sm text-charcoal-ink/70">{copy.meaning}</p>
                  )}
                </div>
              );
            })}

            <p className="rounded-2xl bg-white/60 p-6 text-sm text-charcoal-ink/70">
              Each figure is the longest we allow ourselves, not our best case. Most emergency
              flags reach a doctor far faster than the ceiling shown; the ceiling is what we hold
              ourselves to, whichever part of the platform raised it.
              {published.approvedByName && (
                <>
                  {" "}
                  Version {published.version} was signed by{" "}
                  <span className="font-medium text-charcoal-ink">
                    {published.approvedByName}
                  </span>
                  , our Clinical Director
                  {published.approvedAt
                    ? `, on ${new Date(published.approvedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}`
                    : ""}
                  .
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-6">
            <p className="text-sm text-charcoal-ink/70">
              Our response commitments are being reviewed and re-signed, so we won&apos;t quote a
              number that isn&apos;t currently approved. The escalation process runs unchanged
              throughout: a flagged reading still reaches a doctor, and no urgent case can be
              closed without one.
            </p>
          </div>
        )}
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Your data"
          title="Where it lives and who can reach it"
          description="Plainly, including the part we would rather were different."
        />
        <div className="mx-auto max-w-3xl space-y-4">
          <DataPoint
            title="Stored in Europe, not Nigeria"
            body="Our database is hosted in Ireland; we'd prefer Nigeria, but our infrastructure provider has no African region yet. We're saying this outright rather than leaving it for a policy document, and we will move if that changes."
          />
          <DataPoint
            title="Encrypted in transit and at rest"
            body="Nothing moves between your device and us unencrypted, and nothing sits on disk unencrypted."
          />
          <DataPoint
            title="Access enforced by the database, not by our code"
            body="Every table that holds patient information carries row-level rules inside the database itself, so a mistake in an app screen cannot show one person another person's record. That's checked on every query, not once at login."
          />
          <DataPoint
            title="Family access is granted by you, and it is not symmetrical"
            body="Someone you name as next of kin must accept, then can follow your record without changing it. Someone funding your care sees what their money paid for and what it cost. Neither sees your readings, results, or notes unless you've given them that level yourself."
          />
          <DataPoint
            title="Every clinical action is attributed"
            body="When a doctor reviews your case, the record carries their name and their MDCN registration number. If no doctor has reviewed something, we show you nothing rather than a reassuring label."
          />
        </div>
      </Section>

      <CtaBand
        title="Questions we have not answered here?"
        description="Ask us directly. We would rather answer a hard question before you sign up than after."
        primaryHref="/contact"
        primaryLabel="Ask us"
        secondaryHref="/privacy"
        secondaryLabel="Read the privacy policy"
      />
    </>
  );
}

function DataPoint({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6">
      <p className="font-heading text-base font-semibold text-charcoal-ink">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{body}</p>
    </div>
  );
}
