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

  it("every purpose key it uses exists in the catalogue", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("privacy.purpose."));
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const k of keys) expect(Object.keys(en)).toContain(k);
  });
});
