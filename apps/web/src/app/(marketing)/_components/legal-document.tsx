import Link from "next/link";
import { Section } from "./section";
import type { LegalDocument } from "@/lib/marketing/legal-data";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/** All public legal pages, consent-versioned or static, in one cross-link set. */
const LEGAL_PAGES = [
  { key: "privacy", href: MARKETING_ROUTES.privacy, label: "Data Processing Consent" },
  { key: "telehealthConsent", href: MARKETING_ROUTES.telehealthConsent, label: "Telehealth Consent" },
  { key: "terms", href: MARKETING_ROUTES.terms, label: "Terms of Service" },
  { key: "accessibility", href: MARKETING_ROUTES.accessibility, label: "Accessibility Statement" },
  { key: "cookies", href: MARKETING_ROUTES.cookies, label: "Cookie Policy" },
] as const;

/** Cross-link row shown at the foot of every legal page, omitting whichever one you're on. */
export function LegalCrossLinks({ current }: { current: (typeof LEGAL_PAGES)[number]["key"] }) {
  const links = LEGAL_PAGES.filter((page) => page.key !== current);
  return (
    <p className="mt-10 text-sm text-charcoal-ink/60">
      {links.map((link, i) => (
        <span key={link.key}>
          {i > 0 ? " · " : ""}
          <Link href={link.href} className="underline hover:no-underline">
            {link.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

/**
 * Shared renderer for the DB-backed consent-versioned legal pages (/privacy,
 * /telehealth-consent, /terms) — each page.tsx just loads its own
 * consent_versions row via loadLegalDocument and passes it here. Sections
 * render the same "## Heading" body the onboarding consent step shows, so a
 * patient reads the exact text their acceptance record points at, not a
 * marketing paraphrase. Static legal pages (accessibility, cookies) render
 * their own markup and reuse only LegalCrossLinks above.
 */
export function LegalDocumentPage({
  crumbLabel,
  document,
  documentKey,
}: {
  crumbLabel: string;
  document: LegalDocument | null;
  documentKey: (typeof LEGAL_PAGES)[number]["key"];
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
        <LegalCrossLinks current={documentKey} />
      </article>
    </Section>
  );
}
