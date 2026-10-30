/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PharmacistFirst } from "./pharmacist-first";
import type { FirstView } from "./_lib/first-view";

const top = { key: "orders", href: "/pharmacist/orders", text: "2 orders are waiting for you" } as const;
const second = { key: "licence-soon", href: "/pharmacist/profile", text: "Your pharmacy licence expires soon" } as const;

describe("PharmacistFirst", () => {
  it("leads with the top item as a link and lists the rest after it", () => {
    const view: FirstView = { kind: "items", top, rest: [second], caveat: "none" };
    render(<PharmacistFirst view={view} />);
    const section = screen.getByRole("region", { name: "Needs you first" });
    const links = Array.from(section.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["2 orders are waiting for you", "Your pharmacy licence expires soon"]);
    expect(screen.queryByText(/incomplete|out of date/)).toBeNull();
  });

  it("says the list is incomplete or out of date when it is", () => {
    const { rerender } = render(<PharmacistFirst view={{ kind: "items", top, rest: [], caveat: "incomplete" }} />);
    expect(screen.getByText(/This list is incomplete/)).toBeTruthy();
    rerender(<PharmacistFirst view={{ kind: "items", top, rest: [], caveat: "stale" }} />);
    expect(screen.getByText(/This list may be out of date/)).toBeTruthy();
  });

  it("says what was checked when clear", () => {
    render(<PharmacistFirst view={{ kind: "clear" }} />);
    expect(screen.getByText(/No orders waiting and your licence is in date/)).toBeTruthy();
  });

  it.each(["unknown", "stale", "loading"] as const)(
    "draws nothing, and never a clear day, when the view is %s (the cards below carry the notice)",
    (kind) => {
      const { container } = render(<PharmacistFirst view={{ kind }} />);
      expect(container.textContent).toBe("");
    }
  );

  it("has no accessibility violations", async () => {
    const { container } = render(
      <PharmacistFirst view={{ kind: "items", top, rest: [second], caveat: "incomplete" }} />
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
