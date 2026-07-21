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
        </div>
      </Section>
    </>
  );
}
