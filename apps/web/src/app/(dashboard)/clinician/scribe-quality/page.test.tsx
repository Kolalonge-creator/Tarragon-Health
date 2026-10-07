/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
const staff = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: () => staff() }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: { doctor_tier?: string } | null) => s?.doctor_tier === "chief_medical_officer" }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import ScribeQualityPage from "./page";

const rates = { reviews: 2, sections: { history: { unchanged: 1, edited: 1, emptied: 0, added: 0, empty_kept: 0, flagged_empty: 0 } } };
const note = { note_id: "11111111-1111-4111-8111-111111111111", finalized_at: "2026-10-06T10:00:00Z", author_profile_id: null, has_hash: true };

beforeEach(() => {
  rpc.mockReset();
  staff.mockReset();
});

describe("ScribeQualityPage", () => {
  it("sends anyone who is not the CMO away, and reads nothing", async () => {
    staff.mockResolvedValue({ doctor_tier: "senior_medical_officer" });
    await expect(ScribeQualityPage()).rejects.toThrow("REDIRECT:/clinician");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the per-section counts and the sample for the CMO", async () => {
    staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
    rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === "scribe_edit_rates" ? rates : [note], error: null }));
    render(await ScribeQualityPage());
    expect(screen.getByText(/Drafts taken into a note \(last 90 days\): 2/)).toBeTruthy();
    expect(screen.getByText("history")).toBeTruthy();
    expect(screen.getByText(note.note_id)).toBeTruthy();
    expect(screen.getByText(/Signed hash recorded/)).toBeTruthy();
  });

  it("a failed read is an error, never zero reviews", async () => {
    staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(await ScribeQualityPage());
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/No AI-drafted notes have been signed yet/)).toBeNull();
  });

  it("zero reviews is said plainly", async () => {
    staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
    rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === "scribe_edit_rates" ? { reviews: 0, sections: {} } : [], error: null }));
    render(await ScribeQualityPage());
    expect(screen.getByText(/No AI-drafted notes have been signed yet/)).toBeTruthy();
  });
});
