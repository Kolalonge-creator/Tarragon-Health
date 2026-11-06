/** @jest-environment jsdom */
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { CriticalAttentionBanner } from "./critical-attention-banner";

describe("CriticalAttentionBanner", () => {
  it("renders nothing when there is no emergency", () => {
    const { container } = render(<CriticalAttentionBanner view={{ kind: "none" }} />);
    expect(container.innerHTML).toBe("");
  });

  it("says Emergency in words, gives the count and links the most urgent case", () => {
    render(<CriticalAttentionBanner view={{ kind: "critical", count: 2, firstId: "esc-1" }} />);
    expect(screen.getByRole("alert").textContent).toContain("Emergency: 2 cases are open for you or unassigned.");
    expect(screen.getByRole("link", { name: "Open the most urgent" }).getAttribute("href")).toBe("/clinician/escalations/esc-1");
    expect(screen.getByRole("link", { name: "See all 2" }).getAttribute("href")).toBe("/clinician/escalations");
  });

  it("singular wording and no 'see all' link for one case", () => {
    render(<CriticalAttentionBanner view={{ kind: "critical", count: 1, firstId: "esc-9" }} />);
    expect(screen.getByRole("alert").textContent).toContain("1 case is open for you or unassigned.");
    expect(screen.queryByRole("link", { name: /See all/ })).toBeNull();
  });

  it("offers no dismiss control", () => {
    render(<CriticalAttentionBanner view={{ kind: "critical", count: 1, firstId: "esc-9" }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
