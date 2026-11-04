/**
 * FAQPage structured data for a health article, built from the sections whose heading is a question ("Do I need to fast before
 * the test?"). Google reads it to match an article to the question someone typed. Each answer is the section's own visible
 * text, so the markup never says anything the page does not (Google's rule for FAQ markup, and ours).
 *
 * Returns null when fewer than two sections are questions: a single question is not an FAQ, and an article written as prose
 * keeps only its MedicalWebPage markup.
 */
export type FaqSection = { heading: string; paragraphs: string[] };

export function resourceFaqJsonLd(url: string, sections: readonly FaqSection[]) {
  const questions = sections.filter((s) => s.heading.trim().endsWith("?") && s.paragraphs.some((p) => p.trim().length > 0));
  if (questions.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: questions.map((s) => ({
      "@type": "Question",
      name: s.heading.trim(),
      acceptedAnswer: {
        "@type": "Answer",
        text: s.paragraphs.map((p) => p.trim()).filter(Boolean).join(" "),
      },
    })),
  };
}
