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
const REQ = "11111111-1111-4111-8111-111111111111";
const mockRpc = (protocols: unknown, requests: unknown = [], reqError: unknown = null) =>
  rpc.mockImplementation((fn: string) =>
    Promise.resolve(fn === "research_export_requests_list" ? { data: requests, error: reqError } : (protocols as { data: unknown; error: unknown })));
beforeEach(() => rpc.mockReset());

describe("ResearchPage", () => {
  it("shows a draft with the approve step and waiting states", async () => {
    mockRpc({ data: [{ ...base, id: REQ, title: "Proof protocol", status: "draft" }], error: null });
    render(await ResearchPage(props()));
    expect(screen.getByText("Proof protocol")).toBeTruthy();
    expect(screen.getByText("Approve as Chief Medical Officer")).toBeTruthy();
    expect(screen.getByText(/Waiting for the data protection officer/)).toBeTruthy();
  });
  it("an approved protocol says exports are off when the guard is off", async () => {
    mockRpc({ data: [{ ...base, id: REQ, title: "Approved one", status: "approved", cmo_approved: true, dpo_confirmed: true, can_approve: false, can_export: false }], error: null });
    render(await ResearchPage(props()));
    expect(screen.getByText(/Exports are switched off/)).toBeTruthy();
    expect(screen.queryByText("Download de-identified export")).toBeNull();
  });
  const live = { data: [{ ...base, id: REQ, title: "Live one", status: "approved", cmo_approved: true, dpo_confirmed: true, can_approve: false, can_export: true }], error: null };
  const request = (over: Record<string, unknown> = {}) => ({ id: "22222222-2222-4222-8222-222222222222", protocol_id: REQ, protocol_title: "Live one", requested_at: "2026-10-27T10:00:00Z", note: "Quarterly outcomes study", authorised: false, expired: false, is_mine: true, can_authorise: false, ...over });
  it("with no authorised request it offers to ask for an export, never the download", async () => {
    mockRpc(live);
    render(await ResearchPage(props()));
    expect(screen.getByText("Ask for an export")).toBeTruthy();
    expect(screen.queryByText("Download de-identified export")).toBeNull();
  });
  it("a request waiting for a second person shows the wait and no download", async () => {
    mockRpc(live, [request()]);
    render(await ResearchPage(props()));
    expect(screen.getAllByText(/Waiting for a second person to authorise/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Download de-identified export")).toBeNull();
    expect(screen.queryByText("Authorise this export")).toBeNull();
  });
  it("offers the download only once the request is authorised", async () => {
    mockRpc(live, [request({ authorised: true })]);
    render(await ResearchPage(props()));
    expect(screen.getByText("Download de-identified export")).toBeTruthy();
  });
  it("an expired request does not unlock the download", async () => {
    mockRpc(live, [request({ authorised: true, expired: true })]);
    render(await ResearchPage(props()));
    expect(screen.queryByText("Download de-identified export")).toBeNull();
    expect(screen.getByText("Ask for an export")).toBeTruthy();
  });
  it("the authorise button shows only when the database says this person can authorise", async () => {
    mockRpc(live, [request({ is_mine: false, can_authorise: true })]);
    render(await ResearchPage(props()));
    expect(screen.getByText("Authorise this export")).toBeTruthy();
  });
  it("a requester sees that someone else has to authorise", async () => {
    mockRpc(live, [request()]);
    render(await ResearchPage(props()));
    expect(screen.getByText(/a different person has to authorise it/)).toBeTruthy();
  });
  it("a request list that fails to load shows an error and keeps the download hidden", async () => {
    mockRpc(live, null, { message: "boom", code: "XX000" });
    render(await ResearchPage(props()));
    expect(screen.getByText("The export requests could not be loaded.")).toBeTruthy();
    expect(screen.queryByText("Download de-identified export")).toBeNull();
  });
  it("a failed load is an error and a refusal goes back to /clinician", async () => {
    mockRpc({ data: null, error: { message: "boom", code: "XX000" } });
    render(await ResearchPage(props()));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    mockRpc({ data: null, error: { message: "no", code: "42501" } });
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
