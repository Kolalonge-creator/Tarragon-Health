import type { Metadata } from "next";
import { Section, SectionHeading } from "../_components/section";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Join TarragonHealth, request an employer health plan, or talk to us about HMO partnerships.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source = "homepage" } = await searchParams;

  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Contact"
          title="Join Tarragon Health"
          description="Tell us who you are and what you need: patient, family, employer, or HMO. We will follow up personally."
        />
        <div className="mx-auto max-w-xl">
          <ContactForm source={source} />
          <p className="mt-6 text-center text-sm text-charcoal-ink/60">
            Prefer email? Reach us at{" "}
            <a href="mailto:hello@tarragonhealth.ng" className="font-medium text-brand-green hover:underline">
              hello@tarragonhealth.ng
            </a>{" "}
            for general questions, or{" "}
            <a href="mailto:support@tarragonhealth.ng" className="font-medium text-brand-green hover:underline">
              support@tarragonhealth.ng
            </a>{" "}
            if you're already a patient.
          </p>
        </div>
      </Section>
    </>
  );
}
