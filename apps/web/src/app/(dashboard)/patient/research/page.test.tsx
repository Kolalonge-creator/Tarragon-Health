/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
const mockProfile = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => mockProfile() }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import PatientResearchPage from "./page";
const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });
const ID = "11111111-1111-4111-8111-111111111111";
const use = {
  id: ID, title: "Blood pressure outcomes", question: "Does monthly review lower blood pressure?", recipient_name: "University of Ibadan",
  recipient_type: "academic", ethics_body: "UI ethics committee", ethics_approved_on: "2026-09-01", status: "approved",
  listed_on: "2026-10-01", release_count: 2, last_release_on: "2026-10-20",
};
const answer = (ledger: unknown, mine: unknown = { data: [], error: null }) =>
  rpc.mockImplementation((fn: string) => Promise.resolve(fn === "research_ledger" ? ledger : mine));

beforeEach(() => { rpc.mockReset(); mockProfile.mockResolvedValue({ id: "me", role: "patient" }); });

describe("PatientResearchPage", () => {
  it("lists each approved research use with who receives it and the ethics approval", async () => {
    answer({ data: [use], error: null });
    render(await PatientResearchPage(props()));
    expect(screen.getAllByText("Blood pressure outcomes").length).toBeGreaterThan(0);
    expect(screen.getByText(/University of Ibadan/)).toBeTruthy();
    expect(screen.getByText(/UI ethics committee/)).toBeTruthy();
  });
  it("shows no reference numbers or agreement ids even if the response carried them", async () => {
    answer({ data: [{ ...use, ethics_approval_ref: "ETH-SECRET-9", data_sharing_agreement_ref: "DSA-SECRET-9" }], error: null });
    render(await PatientResearchPage(props()));
    expect(screen.queryByText(/SECRET/)).toBeNull();
  });
  it("says so when nothing is approved", async () => {
    answer({ data: [], error: null });
    render(await PatientResearchPage(props()));
    expect(screen.getByText("No research use is approved at the moment.")).toBeTruthy();
  });
  it("a failed load is an error, not an empty list", async () => {
    answer({ data: null, error: { message: "boom", code: "XX000" } });
    render(await PatientResearchPage(props()));
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByText("No research use is approved at the moment.")).toBeNull();
  });
  it("shows the member their own questions and any answer", async () => {
    answer({ data: [use], error: null }, { data: [{ id: ID, protocol_id: ID, message: "Why is this needed?", status: "answered", answer: "It checks the programme works.", created_at: "2026-10-21T10:00:00Z", answered_at: "2026-10-22T10:00:00Z" }], error: null });
    render(await PatientResearchPage(props()));
    expect(screen.getByText("Why is this needed?")).toBeTruthy();
    expect(screen.getByText("It checks the programme works.")).toBeTruthy();
  });
  it("sends a signed-out visitor to login and a non-patient away", async () => {
    mockProfile.mockResolvedValue(null);
    await expect(PatientResearchPage(props())).rejects.toThrow("REDIRECT:/login");
    mockProfile.mockResolvedValue({ id: "x", role: "clinician" });
    await expect(PatientResearchPage(props())).rejects.toThrow("REDIRECT:/");
  });
});
