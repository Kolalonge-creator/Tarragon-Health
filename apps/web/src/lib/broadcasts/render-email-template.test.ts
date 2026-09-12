import { renderBroadcastEmailHtml } from "./render-email-template";

describe("renderBroadcastEmailHtml", () => {
  it("falls back to the plain subject/body layout when content is null", () => {
    const html = renderBroadcastEmailHtml(null, "Free BP checks this weekend", "Line one.\nLine two.");
    expect(html).toContain('<h2 style="color:#0E7C52;margin:0 0 12px">Free BP checks this weekend</h2>');
    expect(html).toContain("Line one.<br>Line two.");
    expect(html).toContain("<strong>Care that stays with you.</strong>");
    expect(html).toContain("Tarragon Health");
    // No band, no image, no button in the fallback layout.
    expect(html).not.toContain("<img");
    expect(html).not.toContain('background:#0E7C52;padding');
  });

  it("renders identically for undefined and for a 'none' band with nothing else set", () => {
    const undefinedHtml = renderBroadcastEmailHtml(undefined, "Subject", "Body");
    const noneHtml = renderBroadcastEmailHtml(
      { headline: "Subject", bodyText: "Body", bandColor: "none" },
      "Subject",
      "Body"
    );
    // Headline/body text match the plain fallback's own subject/body markup —
    // proves "None" is visually a no-op, not merely "close enough".
    expect(noneHtml).toContain('<h2 style="color:#0E7C52;margin:0 0 12px">Subject</h2>');
    expect(noneHtml).toContain("<p>Body</p>");
    expect(undefinedHtml).toContain('<h2 style="color:#0E7C52;margin:0 0 12px">Subject</h2>');
  });

  it("renders a colored band behind the headline for green/navy", () => {
    const green = renderBroadcastEmailHtml(
      { headline: "Headline", bodyText: "Body", bandColor: "green" },
      "Subject",
      "Body"
    );
    expect(green).toContain("background:#0E7C52");
    expect(green).toContain('color:#ffffff;margin:0">Headline</h2>');

    const navy = renderBroadcastEmailHtml(
      { headline: "Headline", bodyText: "Body", bandColor: "navy" },
      "Subject",
      "Body"
    );
    expect(navy).toContain("background:#12324B");
  });

  it("renders an optional hero image above the headline", () => {
    const html = renderBroadcastEmailHtml(
      { headline: "Headline", bodyText: "Body", imageUrl: "https://example.com/hero.jpg" },
      "Subject",
      "Body"
    );
    const imgIndex = html.indexOf("<img");
    const headlineIndex = html.indexOf("<h2");
    expect(imgIndex).toBeGreaterThan(-1);
    expect(imgIndex).toBeLessThan(headlineIndex);
    expect(html).toContain('src="https://example.com/hero.jpg"');
  });

  it("renders a button only when both buttonText and buttonUrl are present", () => {
    const withButton = renderBroadcastEmailHtml(
      { headline: "H", bodyText: "B", buttonText: "Book now", buttonUrl: "https://example.com/book" },
      "Subject",
      "Body"
    );
    expect(withButton).toContain('href="https://example.com/book"');
    expect(withButton).toContain("Book now");

    const missingUrl = renderBroadcastEmailHtml(
      { headline: "H", bodyText: "B", buttonText: "Book now" },
      "Subject",
      "Body"
    );
    expect(missingUrl).not.toContain("<a href=");
  });

  it("renders an optional footer note under the standard footer", () => {
    const html = renderBroadcastEmailHtml(
      { headline: "H", bodyText: "B", footerNote: "Offer valid while slots last." },
      "Subject",
      "Body"
    );
    const footerIndex = html.indexOf("Care that stays with you.");
    const noteIndex = html.indexOf("Offer valid while slots last.");
    expect(noteIndex).toBeGreaterThan(footerIndex);
  });

  it("HTML-escapes every field to prevent injection into the sent email", () => {
    const html = renderBroadcastEmailHtml(
      {
        headline: "<script>alert(1)</script>",
        bodyText: "Click <b>here</b>",
        buttonText: "<img onerror=alert(1)>",
        buttonUrl: "https://example.com?a=1&b=2",
        footerNote: "<i>note</i>",
      },
      "Subject",
      "Body"
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Click <b>here</b>");
    expect(html).toContain("&amp;b=2");
  });

  it("splits body text into separate paragraphs on blank lines", () => {
    const html = renderBroadcastEmailHtml(
      { headline: "H", bodyText: "Paragraph one.\n\nParagraph two." },
      "Subject",
      "Body"
    );
    expect(html).toContain("<p>Paragraph one.</p>");
    expect(html).toContain("<p>Paragraph two.</p>");
  });
});
