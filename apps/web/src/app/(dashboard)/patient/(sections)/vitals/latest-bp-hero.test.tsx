/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const mockUseVitalsReadings = jest.fn();
jest.mock("@/lib/queries/vitals", () => ({ useVitalsReadings: (id: string) => mockUseVitalsReadings(id) }));

import { LatestBpHero } from "./latest-bp-hero";

describe("LatestBpHero", () => {
  it("shows no second log button when there are no readings (the page's top button is the only one)", () => {
    mockUseVitalsReadings.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<LatestBpHero patientId="p1" />);
    expect(screen.getByText("No readings yet")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /log a reading/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /log a reading/i })).toBeNull();
  });
});
