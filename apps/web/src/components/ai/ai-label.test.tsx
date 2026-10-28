/** @jest-environment jsdom */
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { AI_LABEL_TEXT } from "@tarragon/i18n";
import { AiLabel } from "./ai-label";

describe("AiLabel", () => {
  it("renders the shared wording for each variant", () => {
    for (const [variant, text] of Object.entries(AI_LABEL_TEXT)) {
      const { unmount } = render(<AiLabel variant={variant as keyof typeof AI_LABEL_TEXT} />);
      expect(screen.getByTestId("ai-label").textContent).toBe(text);
      unmount();
    }
  });

  it("uses plain wording with no em or en dash", () => {
    for (const text of Object.values(AI_LABEL_TEXT)) expect(text).not.toMatch(/[–—]/);
  });
});
