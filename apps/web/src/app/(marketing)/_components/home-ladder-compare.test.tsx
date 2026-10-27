/** @jest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { HomeLadderCompare } from "./home-ladder-compare";
import { ladderCards } from "../_content/pricing-ladder";

const cards = ladderCards({ evergreen: "PRICE_A", evergreenPlus: "PRICE_B" });

describe("homepage ladder section", () => {
  it("shows Free, Membership and Membership Plus as three equal cards, with the single difference first and the prices passed in", () => {
    render(<HomeLadderCompare cards={cards} refundDays={21} autoRenews={false} />);
    const grid = screen.getByTestId("home-ladder-cards");
    const names = within(grid).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["Free", "Membership", "Membership Plus"]);
    expect(within(grid).getAllByText(/Annual blood panel: (no|yes)/).map((e) => e.textContent)).toEqual([
      "Annual blood panel: no",
      "Annual blood panel: no",
      "Annual blood panel: yes",
    ]);
    expect(within(grid).getByText(/PRICE_A a year/)).toBeTruthy();
    expect(within(grid).getByText(/PRICE_B a year/)).toBeTruthy();
  });

  it("the paid cards have the same button style, so neither is pushed harder than the other", () => {
    render(<HomeLadderCompare cards={cards} refundDays={21} autoRenews={false} />);
    const buttons = screen.getAllByRole("link", { name: "Get started" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].className).toBe(buttons[1].className);
  });

  it("the renewal sentence follows the switch", () => {
    const { rerender } = render(<HomeLadderCompare cards={cards} refundDays={21} autoRenews={false} />);
    expect(screen.getByText(/does not renew by itself/)).toBeTruthy();
    rerender(<HomeLadderCompare cards={cards} refundDays={21} autoRenews />);
    expect(screen.getByText(/automatic renewal/)).toBeTruthy();
  });

  it("the homepage shows the cards only when the ladder is public, and otherwise keeps the single Membership card", () => {
    const page = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
    expect(page).toContain("membershipLadderPublic()");
    expect(page).toContain("ladderPrices ? (");
    expect(page).toContain("<HomePlanCompare");
  });
});
