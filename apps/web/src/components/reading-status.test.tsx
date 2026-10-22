import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadingStatus } from "./reading-status";
import { STATUS_ICON } from "@/lib/icons";

describe("ReadingStatus", () => {
  it("prints the word and an icon for every level, so colour is never the only signal", () => {
    for (const level of ["green", "amber", "red", "emergency"] as const) {
      const html = renderToStaticMarkup(<ReadingStatus level={level} word="A plain word" value="120/80 mmHg" />);
      expect(html).toContain("A plain word");
      expect(html).toContain("120/80 mmHg");
      expect(html).toContain("<svg");
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-level="${level}"`);
    }
  });

  it("uses a different icon shape per level", () => {
    const icons = new Set(Object.values(STATUS_ICON));
    expect(icons.size).toBe(Object.keys(STATUS_ICON).length);
  });
});
