import { faqPageJsonLd } from "./faq-json-ld";

describe("faqPageJsonLd", () => {
  it("builds FAQPage data and escapes < so an answer cannot close the script tag", () => {
    const out = faqPageJsonLd([{ question: "Q?", answer: "a </script><b>" }]);
    expect(out).not.toContain("</script>");
    const parsed = JSON.parse(out);
    expect(parsed["@type"]).toBe("FAQPage");
    expect(parsed.mainEntity[0].acceptedAnswer.text).toBe("a </script><b>");
  });
});
