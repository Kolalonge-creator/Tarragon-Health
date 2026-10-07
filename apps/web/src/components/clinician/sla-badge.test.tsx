/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { SlaBadge } from "./sla-badge";

const now = new Date("2026-10-06T10:00:00Z");

describe("SlaBadge", () => {
  it("says overdue past the due time", () => {
    render(<SlaBadge dueAt="2026-10-06T09:00:00Z" now={now} />);
    expect(screen.getByText("Overdue")).toBeTruthy();
  });
  it("says minutes left before it", () => {
    render(<SlaBadge dueAt="2026-10-06T10:30:00Z" now={now} />);
    expect(screen.getByText("Due in 30 minutes")).toBeTruthy();
  });
  it("renders nothing without a due time", () => {
    const { container } = render(<SlaBadge dueAt={null} now={now} />);
    expect(container.textContent).toBe("");
  });
});
