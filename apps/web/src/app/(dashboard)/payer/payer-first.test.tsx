/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PayerFirst } from "./payer-first";
import type { FirstView } from "@/lib/payer/first-view";

const top = { key: "preauth", href: "/payer/preauthorizations?insurer=i", text: "2 pre-authorisations are waiting for a decision" } as const;
const second = { key: "adjudicate", href: "/payer/claims?insurer=i", text: "5 claims are waiting to be adjudicated" } as const;

describe("PayerFirst", () => {
  it("leads with the top item as a link and lists the rest after it", () => {
    const view: FirstView = { kind: "items", top, rest: [second], incomplete: false };
    render(<PayerFirst view={view} />);
    const section = screen.getByRole("region", { name: "Needs you first" });
    const links = Array.from(section.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual([top.text, second.text]);
    expect(screen.queryByText(/This list is incomplete/)).toBeNull();
  });

  it("says the list is incomplete when a queue failed", () => {
    render(<PayerFirst view={{ kind: "items", top, rest: [], incomplete: true }} />);
    expect(screen.getByText(/This list is incomplete/)).toBeTruthy();
  });

  it("says what was checked when clear", () => {
    render(<PayerFirst view={{ kind: "clear" }} />);
    expect(screen.getByText(/No pre-authorisations to decide/)).toBeTruthy();
  });

  it("does not say nothing is waiting when it could not check", () => {
    render(<PayerFirst view={{ kind: "unknown" }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot say whether anything is waiting/);
    expect(screen.queryByText(/No pre-authorisations to decide/)).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<PayerFirst view={{ kind: "items", top, rest: [second], incomplete: true }} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
