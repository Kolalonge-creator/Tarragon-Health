/** @jest-environment jsdom */
/** Design audit P3: the directory opens on results, never sends a place on load, and folds the optional filters. */
import { fireEvent, render, screen } from "@testing-library/react";

let rows: unknown[] = [];
const calls: { args: Record<string, unknown>; enabled: boolean }[] = [];
jest.mock("@/lib/queries/directory", () => ({
  DirectoryNotOpenError: class extends Error {},
  useDirectorySearch: (args: Record<string, unknown>, enabled: boolean) => {
    calls.push({ args, enabled });
    return { data: rows, isSuccess: true, isError: false, error: null };
  },
  useReportListing: () => ({ mutate: jest.fn(), isPending: false, isSuccess: false, isError: false }),
  useRequestBooking: () => ({ mutate: jest.fn(), isPending: false, isSuccess: false, isError: false }),
}));

import { DirectorySearch } from "./directory-search";

const row = (id: string, name: string) => ({
  listing_table: "facilities", listing_id: id, name, tier: "verified", last_verified_at: null, address: "1 Road", city: "Ikeja", state: "Lagos",
  phone: null, latitude: null, longitude: null, distance_km: null, open_now: null, hours_text: null, price_kobo: null, hmo_status: null,
  nhia_status: null, rating_count: 0, rating_average: null,
});

describe("DirectorySearch", () => {
  beforeEach(() => {
    calls.length = 0;
    rows = [row("1", "Clinic A"), row("2", "Clinic B")];
  });

  it("searches on load with no filters and no location, and shows a count", () => {
    render(<DirectorySearch locale="en" />);
    expect(calls[0].enabled).toBe(true);
    expect(calls[0].args).toEqual({ p_limit: 50 });
    expect(screen.getByText("2 places")).not.toBeNull();
    expect(screen.getByText("Clinic A")).not.toBeNull();
  });

  it("keeps State and Search on the main row and folds the other filters, counting the active ones", () => {
    const { container } = render(<DirectorySearch locale="en" />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByLabelText(/state/i)).not.toBeNull();
    fireEvent.click(screen.getByText("More filters"));
    fireEvent.click(screen.getByLabelText(/NHIA/i));
    expect(screen.getByText("1 on")).not.toBeNull();
  });
});
