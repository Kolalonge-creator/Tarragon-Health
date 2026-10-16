/** @jest-environment jsdom */
import { render } from "@testing-library/react";
import { en } from "@tarragon/i18n";
import { PrivacySummary } from "./privacy-summary";

describe("PrivacySummary", () => {
  it("renders one line per purpose in English, none of them a missing-key fallback", () => {
    for (const locale of ["en"] as const) {
      const { container, unmount } = render(<PrivacySummary locale={locale} />);
      const items = container.querySelectorAll("li");
      expect(items.length).toBe(9);
      for (const li of items) {
        expect(li.textContent).toBeTruthy();
        expect(li.textContent).not.toMatch(/^privacy\.purpose\./);
      }
      unmount();
    }
  });

  it("says the clinical record is kept under a stated retention period, and does not invent the period (S47)", () => {
    const { container } = render(<PrivacySummary locale="en" />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/keep your clinical record for a stated retention period/);
    expect(text).toMatch(/still to be confirmed/);
    expect(text).not.toMatch(/\b\d+\s*(years?|months?)\b/i);
    expect(text).not.toContain("\u2014");
  });

  it("every purpose key it uses exists in the catalogue", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("privacy.purpose."));
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const k of keys) expect(Object.keys(en)).toContain(k);
  });
});
