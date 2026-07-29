import Link from "next/link";
import { Section } from "./section";
import type { LegalDocument } from "@/lib/marketing/legal-data";

/**
 * Shared renderer for the three public legal pages (/privacy,
 * /telehealth-consent, /terms) — each page.tsx just loads its own
 * consent_versions row via loadLegalDocument and passes it here. Sections
 * render the same "## Heading" body the onboarding consent step shows, so a
 * patient reads the exact text their acceptance record points at, not a
 * marketing paraphrase.
 */
export function LegalDocumentPage({
  crumbLabel,
  document,
}: {
  crumbLabel: string;
  document: LegalDocument | null;
}) {
  return (
    <Section className="pt-20">
      <article className="mx-auto max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-wide text-deep-forest">
          {crumbLabel}
        </p>
        {document ? (
          <>
            <h1 className="mt-2 font-heading text-3xl font-bold leading-tight text-charcoal-ink sm:text-4xl">
              {document.title}
            </h1>
            <p className="mt-4 text-xs text-charcoal-ink/50">
              Version {document.version} · last published{" "}
              {new Date(document.publishedAt).toLocaleDateString("en-NG", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
            <p className="mt-6 rounded-xl border border-charcoal-ink/10 bg-soft-sage/50 p-4 text-sm text-charcoal-ink/70">
              This document is being finalised with our legal counsel and may be updated —
              bracketed passages mark details still being confirmed. Questions:{" "}
              <a href="mailto:legal@tarragonhealth.ng" className="underline">
                legal@tarragonhealth.ng
              </a>
              .
            </p>
            <div className="mt-10 space-y-8">
              {document.sections.map((section) => (
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
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-charcoal-ink/10 bg-white p-6 text-sm text-charcoal-ink/70">
            This document is temporarily unavailable. Please try again shortly, or contact{" "}
            <a href="mailto:legal@tarragonhealth.ng" className="underline">
              legal@tarragonhealth.ng
            </a>
            .
          </div>
        )}
        <p className="mt-10 text-sm text-charcoal-ink/60">
          <Link href="/privacy" className="underline hover:no-underline">
            Data Processing Consent
          </Link>
          {" · "}
          <Link href="/telehealth-consent" className="underline hover:no-underline">
            Telehealth Consent
          </Link>
          {" · "}
          <Link href="/terms" className="underline hover:no-underline">
            Terms of Service
          </Link>
        </p>
      </article>
    </Section>
  );
}
