/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { FoundingMemberBadge } from "./founding-member-badge";

afterEach(cleanup);

describe("FoundingMemberBadge", () => {
  it("says Founding member in words, with the icon hidden from assistive technology", async () => {
    render(<FoundingMemberBadge locale="en" />);
    expect(screen.getByText("Founding member")).toBeTruthy();
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    await expectNoA11yViolations(<FoundingMemberBadge locale="en" withDetail />);
  });

  it("adds the one-line explanation only when asked", () => {
    render(<FoundingMemberBadge locale="en" />);
    expect(screen.queryByText(/first members/)).toBeNull();
    cleanup();
    render(<FoundingMemberBadge locale="en" withDetail />);
    expect(screen.getByText("You joined as one of Tarragon's first members.")).toBeTruthy();
  });
});
