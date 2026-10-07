/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { toCsv } from "@/lib/research/model";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me", language: "en" }) }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import ResearchPage from "./page";
const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });
const base = { recipient_name: "Proof University", recipient_type: "academic", ethics_approval_ref: "ETH-1", data_sharing_agreement_ref: "DSA-1", cmo_approved: false, dpo_confirmed: false, export_count: 0, can_approve: true, can_confirm_dpo: false, can_export: false };
beforeEach(() => rpc.mockReset());

describe("ResearchPage", () => {
  it("shows a draft with the approve step and waiting states", async () => {
    rpc.mockResolvedValue({ data: [{ ...base, id: "11111111-1111-4111-8111-111111111111", title: "Proof protocol", status: "draft" }], error: null });
    render(await ResearchPage(props()));
    expect(screen.getByText("Proof protocol")).toBeTruthy();
    expect(screen.getByText("Approve as Chief Medical Officer")).toBeTruthy();
    expect(screen.getByText(/Waiting for the data protection officer/)).toBeTruthy();
  });
  it("an approved protocol says exports are off when the guard is off", async () => {
    rpc.mockResolvedValue({ data: [{ ...base, id: "11111111-1111-4111-8111-111111111111", title: "Approved one", status: "approved", cmo_approved: true, dpo_confirmed: true, can_approve: false, can_export: false }], error: null });
    render(await ResearchPage(props()));
    expect(screen.getByText(/Exports are switched off/)).toBeTruthy();
    expect(screen.queryByText("Download de-identified export")).toBeNull();
  });
  it("offers the download only when the database says it can export", async () => {
    rpc.mockResolvedValue({ data: [{ ...base, id: "11111111-1111-4111-8111-111111111111", title: "Live one", status: "approved", cmo_approved: true, dpo_confirmed: true, can_approve: false, can_export: true }], error: null });
    render(await ResearchPage(props()));
    expect(screen.getByText("Download de-identified export")).toBeTruthy();
  });
  it("a failed load is an error and a refusal goes back to /clinician", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    render(await ResearchPage(props()));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    await expect(ResearchPage(props())).rejects.toThrow("REDIRECT:/clinician");
  });
});

describe("toCsv", () => {
  it("escapes values and neutralises spreadsheet formulas", () => {
    const csv = toCsv(["a", "b"], [{ participant: "abc", a: "=1+1", b: 'say "hi", ok' }]);
    expect(csv).toBe('participant,a,b\r\nabc,\'=1+1,"say ""hi"", ok"\r\n');
  });
  it("writes an empty cell for null", () => {
    expect(toCsv(["a"], [{ participant: "p", a: null }])).toBe("participant,a\r\np,\r\n");
  });
});
