/**
 * schema.org FAQPage structured data for a list of question/answer pairs,
 * serialised safely for an inline <script type="application/ld+json">.
 * One helper so every marketing page escapes "<" the same way (a "</script>"
 * inside an answer would otherwise end the script tag early).
 */
export function faqPageJsonLd(items: ReadonlyArray<{ question: string; answer: string }>): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  }).replace(/</g, "\\u003c");
}
