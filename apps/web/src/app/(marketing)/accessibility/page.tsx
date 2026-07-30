import type { Metadata } from "next";
import { Section } from "../_components/section";
import { LegalCrossLinks } from "../_components/legal-document";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { absoluteUrl } from "@/lib/marketing/site";

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description:
    "TarragonHealth's commitment to an accessible website and platform, what we've done, known limitations, and how to report a problem.",
  alternates: { canonical: absoluteUrl(MARKETING_ROUTES.accessibility) },
};

const LAST_UPDATED = "30 July 2026";

export default function AccessibilityPage() {
  return (
    <Section className="pt-20">
      <article className="mx-auto max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-wide text-deep-forest">Legal</p>
        <h1 className="mt-2 font-heading text-3xl font-bold leading-tight text-charcoal-ink sm:text-4xl">
          Accessibility Statement
        </h1>
        <p className="mt-4 text-xs text-charcoal-ink/50">Last updated {LAST_UPDATED}</p>

        <div className="mt-10 space-y-8">
          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Our commitment
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              TarragonHealth is health infrastructure, and health infrastructure has to work for
              everyone, including people who use assistive technology such as screen readers,
              screen magnifiers, voice control, or keyboard-only navigation. We aim to meet the
              Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA across our public
              website and patient/clinician platform.
            </p>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              We are not currently certified against WCAG or any other accessibility standard by
              an outside auditor. This statement describes an ongoing effort, not a finished
              guarantee.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              What we do to meet that goal
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-charcoal-ink/80">
              <li>Semantic HTML and heading structure, so screen readers can navigate the page.</li>
              <li>Visible keyboard focus states on every interactive element, and full keyboard
                operability for forms, menus, and dialogs.</li>
              <li>Text alternatives for meaningful images and icons.</li>
              <li>A colour palette checked for contrast, and status colours (for example the
                clinical red/amber/green used on dashboards) that never rely on colour alone.</li>
              <li>Automated accessibility checks (including Lighthouse) as part of how we build
                and review new pages, with issues fixed as we find them.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Known limitations
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              TarragonHealth is under active development and new features ship frequently. Some
              generated documents (for example PDF health records or vaccination certificates)
              and some partner-provided content (lab and pharmacy partner materials) may not yet
              fully meet these standards. If you find a page or feature that doesn&apos;t work with
              your assistive technology, please tell us; we treat these as real bugs, not
              nice-to-haves.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Reporting a problem
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              If you encounter an accessibility barrier anywhere on our website or platform,
              contact{" "}
              <a href="mailto:support@tarragonhealth.ng" className="underline">
                support@tarragonhealth.ng
              </a>{" "}
              and describe the page, what you were trying to do, and the assistive technology you
              were using. We&apos;ll work with you to get the information or service you need in an
              alternate way while we fix the underlying issue, and we aim to acknowledge reports
              within two business days.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Emergencies
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              This page is for reporting accessibility problems with our website and platform, not
              for medical emergencies. TarragonHealth does not provide emergency care; in a
              medical emergency, go to your nearest hospital or call your local emergency number.
            </p>
          </section>
        </div>

        <LegalCrossLinks current="accessibility" />
      </article>
    </Section>
  );
}
