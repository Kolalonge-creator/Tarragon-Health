/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { StandoutHero } from "./standout-hero";
import type { StandoutView } from "@/lib/analytics/standout";

const top = { key: "risk", href: "/analytics/governance", text: "2 open risk items need review" } as const;
const second = { key: "facilities", href: "/analytics/facilities", text: "1 facility has no activity" } as const;

describe("StandoutHero", () => {
  it("leads with the top item as a link and lists the rest after it", () => {
    const view: StandoutView = { kind: "items", top, rest: [second], incomplete: false };
    render(<StandoutHero view={view} />);
    const section = screen.getByRole("region", { name: "What stands out" });
    const links = Array.from(section.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["2 open risk items need review", "1 facility has no activity"]);
    expect(screen.queryByText(/This list is incomplete/)).toBeNull();
  });

  it("says the list is incomplete when a source failed", () => {
    render(<StandoutHero view={{ kind: "items", top, rest: [], incomplete: true }} />);
    expect(screen.getByText(/This list is incomplete/)).toBeTruthy();
  });

  it("says what was checked when nothing stands out", () => {
    render(<StandoutHero view={{ kind: "clear" }} />);
    expect(screen.getByText(/No open risk items, unverified licences/)).toBeTruthy();
  });

  it("does not say nothing stands out when it could not check", () => {
    render(<StandoutHero view={{ kind: "unknown" }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot say whether anything stands out/);
    expect(screen.queryByText(/No open risk items/)).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <StandoutHero view={{ kind: "items", top, rest: [second], incomplete: true }} />
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
