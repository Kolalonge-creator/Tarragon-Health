import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { MARKETING_DEVICES, DEVICES_FAQ } from "../_content/devices";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Devices that work well with Tarragon",
  description:
    "You do not need a device, because typing in a reading takes seconds. If you want one, these blood pressure monitors, scales and glucometers work well.",
  path: MARKETING_ROUTES.devices,
});

export default function DevicesPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Devices"
          title="Devices that work well with Tarragon"
          description="You do not need a device, because typing a reading into the app takes seconds. If you would like one anyway, these are well-regarded third-party models whose own apps share readings with Apple Health or Health Connect, which Tarragon reads as sync is introduced. Tarragon does not make or sell these devices and earns nothing from them."
        />

        <h2 className="sr-only">Suggested devices</h2>
        <div className="mx-auto mt-10 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {MARKETING_DEVICES.map((device) => (
            <div
              key={device.deviceName}
              className="flex flex-col rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
                {device.categoryLabel}
              </p>
              <h3 className="mt-2 font-heading text-lg font-semibold text-charcoal-ink">
                {device.deviceName}
              </h3>
              <p className="text-sm text-charcoal-ink/65">{device.vendorName}</p>
              <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-green/30 bg-soft-sage px-3 py-1 text-xs font-medium text-deep-forest">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
                  <path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Syncs via Apple Health or Health Connect
              </span>
              <p className="mt-3 flex-1 text-sm text-charcoal-ink/70">{device.whyWeRecommend}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/70">
          If you do not have a compatible device, or would rather not buy one, every reading can
          also be entered by hand in the app. A device only makes this faster.{" "}
          <Link href="/signup" className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
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
          description="Join TarragonHealth and keep your care connected over time."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
