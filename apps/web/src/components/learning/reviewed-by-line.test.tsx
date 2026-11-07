/** @jest-environment jsdom */
/** P20: the reviewer line on Learn items comes only from a real reviewer record; with none, nothing about review is shown. */
import { render } from "@testing-library/react";
import { ReviewedByLine } from "./reviewed-by-line";

describe("ReviewedByLine", () => {
  it("shows the reviewer and the review date from the record", () => {
    const { container } = render(<ReviewedByLine name="Dr Amaka Obi" reviewedAt="2026-09-01T10:00:00Z" />);
    expect(container.textContent).toBe("Reviewed by Dr Amaka ObiLast reviewed 2026-09-01");
  });

  it("shows the reviewer alone when there is no date", () => {
    const { container } = render(<ReviewedByLine name="Dr Amaka Obi" />);
    expect(container.textContent).toBe("Reviewed by Dr Amaka Obi");
  });

  it("shows nothing at all without a named reviewer, even when a date exists", () => {
    for (const name of [null, undefined, "", "   "]) {
      const { container, unmount } = render(<ReviewedByLine name={name} reviewedAt="2026-09-01" />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});
