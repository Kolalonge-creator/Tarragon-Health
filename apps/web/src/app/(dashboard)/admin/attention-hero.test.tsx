/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { attentionView, figure, type AttentionItem, type AttentionKey } from "@tarragon/shared";
import { AttentionHero } from "./attention-hero";

const item = (key: AttentionKey, count: ReturnType<typeof figure>, text: string = key): AttentionItem => ({
  key,
  label: (n) => `${n} ${text}`,
  href: `/admin/${key}`,
  count,
});

describe("AttentionHero", () => {
  it("every read failed: says it could not load and never says nothing is waiting", () => {
    const html = renderToStaticMarkup(<AttentionHero view={attentionView([item("serious_incidents", figure(0, true)), item("booking_requests", figure(null, true))])} />);
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("Nothing is waiting");
  });

  it("everything loaded and empty is the clear state", () => {
    const html = renderToStaticMarkup(<AttentionHero view={attentionView([item("booking_requests", figure(0, false))])} />);
    expect(html).toContain("Nothing is waiting on you");
  });

  it("leads with the most urgent item, links to it, and lists the rest", () => {
    const html = renderToStaticMarkup(
      <AttentionHero view={attentionView([item("booking_requests", figure(5, false), "bookings"), item("serious_incidents", figure(1, false), "incidents")])} />,
    );
    expect(html.indexOf("1 incidents")).toBeLessThan(html.indexOf("5 bookings"));
    expect(html).toContain('href="/admin/serious_incidents"');
    expect(html).toContain('href="/admin/booking_requests"');
  });

  it("a partial failure is shown on the list, so a short list is not read as complete", () => {
    const html = renderToStaticMarkup(
      <AttentionHero view={attentionView([item("serious_incidents", figure(null, true)), item("booking_requests", figure(2, false), "bookings")])} />,
    );
    expect(html).toContain("2 bookings");
    expect(html).toContain("This list is incomplete");
    expect(html).toContain("serious incidents");
  });
});
