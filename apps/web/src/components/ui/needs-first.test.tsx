/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { NeedsFirst } from "./needs-first";

const top = { key: "a", href: "/a", text: "2 things are waiting" };
const second = { key: "b", href: "#b", text: "1 other thing" };

describe("NeedsFirst", () => {
  it("leads with the top item as a link, then lists the rest", () => {
    render(<NeedsFirst id="t" body={{ kind: "items", top, rest: [second] }} />);
    const section = screen.getByRole("region", { name: "Needs you first" });
    expect(Array.from(section.querySelectorAll("a")).map((a) => a.textContent)).toEqual([top.text, second.text]);
    expect(section.querySelector("ul")).not.toBeNull();
  });

  it("draws no list when there is only one item, and the notice only when given", () => {
    const { rerender } = render(<NeedsFirst id="t" body={{ kind: "items", top, rest: [] }} />);
    expect(document.querySelector("ul")).toBeNull();
    expect(screen.queryByText("Incomplete.")).toBeNull();
    rerender(<NeedsFirst id="t" body={{ kind: "items", top, rest: [], notice: "Incomplete." }} />);
    expect(screen.getByText("Incomplete.")).toBeTruthy();
  });

  it("shows loading and clear text without any link", () => {
    const { rerender } = render(<NeedsFirst id="t" body={{ kind: "loading", text: "Checking…" }} />);
    expect(screen.getByText("Checking…")).toBeTruthy();
    rerender(<NeedsFirst id="t" body={{ kind: "clear", text: "Nothing waiting." }} />);
    expect(screen.getByText("Nothing waiting.")).toBeTruthy();
    expect(document.querySelector("a")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<NeedsFirst id="t" body={{ kind: "items", top, rest: [second] }} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
