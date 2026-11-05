/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { HomeEntryChips } from "./home-entry-chips";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

describe("HomeEntryChips", () => {
  it("links to Where we work from the top of the home page, not only the footer", () => {
    render(<HomeEntryChips />);
    const link = screen.getByRole("link", { name: "See where we work" });
    expect(link.getAttribute("href")).toBe(MARKETING_ROUTES.coverage);
    expect(screen.getByText(/Tarragon works anywhere in Nigeria\./)).toBeTruthy();
  });
});
