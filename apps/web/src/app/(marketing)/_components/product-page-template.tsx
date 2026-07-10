import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Section, SectionHeading } from "./section";
import { CtaBand } from "./cta-band";
import type { ProductPageContent } from "../_content/products";
import { PRICING_HREF } from "../_content/products";

export function ProductPageTemplate({ content }: { content: ProductPageContent }) {
  return (
    <>
      <Section className="pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">
            {content.headline}
          </h1>
          {content.campaignLine ? (
            <p className="mt-6 font-heading text-xl text-brand-green">{content.campaignLine}</p>
          ) : null}
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">{content.intro}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Start monitoring</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={PRICING_HREF}>View pricing</Link>
            </Button>
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading title="How it works for you" />
        <ol className="mx-auto grid max-w-3xl gap-6">
          {content.howItWorks.map((item, index) => (
            <li
              key={item.title}
              className="flex gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-semibold text-white"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
                <p className="mt-1 text-charcoal-ink/70">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <CtaBand
          title="Ready to get started?"
          description="Join TarragonHealth and bring continuity to your care."
          secondaryHref={PRICING_HREF}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
