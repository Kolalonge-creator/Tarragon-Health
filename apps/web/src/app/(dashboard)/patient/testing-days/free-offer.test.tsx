/** @jest-environment jsdom */
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { FreeTestingDaysOffer } from "./free-offer";

describe("FreeTestingDaysOffer", () => {
  it("shows the tests, the naira price and the Membership prompt when the catalogue is open", () => {
    render(
      <FreeTestingDaysOffer
        offer={{ options: [{ code: "x", nameKey: "no.such.key", amountKobo: 12_900_000, panel: true }], showPanelTests: true }}
      />,
    );
    expect(screen.getByText(/part of Membership/i)).toBeTruthy();
    expect(screen.getByText(/HbA1c/)).toBeTruthy();
    expect(screen.getByText(/129,000/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /See what Membership includes/ }).getAttribute("href")).toBe("/patient/membership");
  });

  it("shows only the prompt, with no price, when the catalogue is closed or unreadable", () => {
    render(<FreeTestingDaysOffer offer={{ options: [], showPanelTests: false }} />);
    expect(screen.getByText(/part of Membership/i)).toBeTruthy();
    expect(screen.queryByText(/₦/)).toBeNull();
    expect(screen.queryByText(/HbA1c/)).toBeNull();
    expect(screen.getByRole("link", { name: /See what Membership includes/ })).toBeTruthy();
  });
});
