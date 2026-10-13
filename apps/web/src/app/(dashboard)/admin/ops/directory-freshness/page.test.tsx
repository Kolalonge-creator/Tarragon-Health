/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me", language: "en" }) }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import DirectoryFreshnessPage from "./page";

const base = { listing_id: "11111111-1111-4111-8111-111111111111", is_active: true, last_verified_at: null, verified_by_name: null, next_verification_due: null, days_overdue: null, can_record: true };
const rows = [
  { ...base, listing_table: "lab_providers", name: "Late Lab", status: "overdue", days_overdue: 12, last_verified_at: "2025-09-01T10:00:00Z", next_verification_due: "2026-09-24" },
  { ...base, listing_table: "pharmacy_partners", listing_id: "22222222-2222-4222-8222-222222222222", name: "Never Pharmacy", status: "never_verified" },
  { ...base, listing_table: "facilities", listing_id: "33333333-3333-4333-8333-333333333333", name: "Fine Clinic", status: "current", last_verified_at: "2026-09-30T10:00:00Z", next_verification_due: "2027-09-30" },
];
const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });

beforeEach(() => rpc.mockReset());

describe("DirectoryFreshnessPage", () => {
  it("lists an overdue and a never verified listing, and a form to record", async () => {
    rpc.mockResolvedValue({ data: rows, error: null });
    render(await DirectoryFreshnessPage(props()));
    expect(screen.getByText("Late Lab")).toBeTruthy();
    expect(screen.getByText(/12 days overdue/)).toBeTruthy();
    expect(screen.getByText("Never Pharmacy")).toBeTruthy();
    expect(screen.getAllByText("Record verification").length).toBe(2);
    expect(screen.getByText(/1 listings are up to date/)).toBeTruthy();
  });
  it("says it cannot record when the viewer may not", async () => {
    rpc.mockResolvedValue({ data: [{ ...rows[0], can_record: false }], error: null });
    render(await DirectoryFreshnessPage(props()));
    expect(screen.queryByText("Record verification")).toBeNull();
    expect(screen.getByText(/not record a check/)).toBeTruthy();
  });
  it("a failed load is an error, never an empty 'all current'", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    render(await DirectoryFreshnessPage(props()));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(screen.queryByText(/No listing is overdue/)).toBeNull();
  });
  it("sends someone the database refuses back to /admin", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    await expect(DirectoryFreshnessPage(props())).rejects.toThrow("REDIRECT:/admin");
  });
});
