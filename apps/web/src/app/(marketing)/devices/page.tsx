import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { MARKETING_DEVICES, DEVICES_FAQ } from "../_content/devices";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Get the right device for your health plan",
  description:
    "Blood pressure monitors, scales and glucometers TarragonHealth has clinically vetted for accuracy and app compatibility — buy from a trusted retailer, readings sync straight into your record.",
  path: MARKETING_ROUTES.devices,
});

export default function DevicesPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Devices"
          title="Get the right device for your health plan"
          description="These are third-party devices we've clinically vetted for accuracy and app compatibility — Tarragon doesn't manufacture or sell them itself. Pick one below, or use any Bluetooth device that syncs to Apple Health or Health Connect."
        />

        <div className="mx-auto max-w-4xl rounded-xl border border-charcoal-ink/10 bg-soft-sage/40 p-4 text-sm text-charcoal-ink/70">
          Tarragon earns a small commission when you buy through a link on this page, at no extra
          cost to you. It never affects which devices we recommend — that&apos;s based on clinical
          accuracy and confirmed compatibility only.
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {MARKETING_DEVICES.map((device) => (
            <div
              key={device.deviceName}
              className="flex flex-col rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
                {device.categoryLabel}
              </p>
              <h3 className="mt-2 font-heading text-lg font-semibold text-charcoal-ink">
                {device.deviceName}
              </h3>
              <p className="text-sm text-charcoal-ink/50">{device.vendorName}</p>
              <span className="mt-3 inline-flex w-fit items-center rounded-full bg-brand-green px-3 py-1 text-xs font-medium text-white">
                ✅ Works with Tarragon
              </span>
              <p className="mt-3 flex-1 text-sm text-charcoal-ink/70">{device.whyWeRecommend}</p>
              <div className="mt-5 space-y-2">
                <Button asChild className="w-full">
                  <a href={device.buyHref} target="_blank" rel="noopener sponsored">
                    Buy Now
                  </a>
                </Button>
                {device.alternative ? (
                  <a
                    href={device.alternative.href}
                    target="_blank"
                    rel="noopener sponsored"
                    className="block text-center text-xs font-medium text-charcoal-ink/60 underline hover:text-brand-green"
                  >
                    {device.alternative.label}
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/70">
          Don&apos;t have a compatible device yet, or would rather not buy one? Every reading can
          be logged by hand in the app too — a device just makes it faster.{" "}
          <Link href="/signup" className="font-medium text-deep-forest hover:underline">
            Get started
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Questions" title="Before you buy" />
        <FaqAccordion items={[...DEVICES_FAQ]} />
      </Section>

      <Section>
        <CtaBand
          title="Ready to get started?"
          description="Join TarragonHealth and bring continuity to your care."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
