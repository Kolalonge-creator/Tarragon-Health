import { describe, expect, it } from "@jest/globals";
import { resourceFaqJsonLd } from "./resource-faq";

const url = "https://tarragonhealth.ng/resources/hba1c-explained";

describe("resourceFaqJsonLd", () => {
  it("turns question headings into FAQ entries whose answers are the visible text", () => {
    const ld = resourceFaqJsonLd(url, [
      { heading: "What is the 3-month sugar test called?", paragraphs: ["It is HbA1c.", "Also written A1C."] },
      { heading: "Reading your result", paragraphs: ["Prose section, not a question."] },
      { heading: "Do I need to fast before the test? ", paragraphs: ["No."] },
    ]);
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: [
        { "@type": "Question", name: "What is the 3-month sugar test called?", acceptedAnswer: { "@type": "Answer", text: "It is HbA1c. Also written A1C." } },
        { "@type": "Question", name: "Do I need to fast before the test?", acceptedAnswer: { "@type": "Answer", text: "No." } },
      ],
    });
  });

  it("emits nothing for prose articles, a single question, or a question with no answer text", () => {
    expect(resourceFaqJsonLd(url, [{ heading: "Why it's called silent", paragraphs: ["…"] }])).toBeNull();
    expect(resourceFaqJsonLd(url, [{ heading: "Only one?", paragraphs: ["Yes."] }, { heading: "Prose", paragraphs: ["x"] }])).toBeNull();
    expect(resourceFaqJsonLd(url, [{ heading: "Empty?", paragraphs: ["  "] }, { heading: "Real?", paragraphs: ["Yes."] }])).toBeNull();
  });
});
