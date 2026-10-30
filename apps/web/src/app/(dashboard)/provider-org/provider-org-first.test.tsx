/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ProviderOrgFirst } from "./provider-org-first";
import type { FirstView } from "@/lib/provider-org/first-view";

const top = { key: "paid", href: "/provider-org/referrals?org=o", text: "2 referrals are paid and waiting to be booked" } as const;
const second = { key: "waitlisted", href: "/provider-org/referrals?org=o", text: "1 referral is on the waitlist" } as const;

describe("ProviderOrgFirst", () => {
  it("leads with the top item as a link and lists the rest after it", () => {
    const view: FirstView = { kind: "items", top, rest: [second] };
    render(<ProviderOrgFirst view={view} />);
    const section = screen.getByRole("region", { name: "Needs you first" });
    expect(Array.from(section.querySelectorAll("a")).map((a) => a.textContent)).toEqual([top.text, second.text]);
  });

  it("says what was checked when clear", () => {
    render(<ProviderOrgFirst view={{ kind: "clear" }} />);
    expect(screen.getByText(/No referrals are paid and waiting/)).toBeTruthy();
  });

  it("draws nothing when the figures did not load (the page shows the failure notice)", () => {
    const { container } = render(<ProviderOrgFirst view={{ kind: "unknown" }} />);
    expect(container.textContent).toBe("");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ProviderOrgFirst view={{ kind: "items", top, rest: [second] }} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
