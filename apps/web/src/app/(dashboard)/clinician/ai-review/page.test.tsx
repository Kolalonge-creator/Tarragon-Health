/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me", language: "en" }) }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import AiReviewPage from "./page";
const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });
beforeEach(() => rpc.mockReset());

describe("AiReviewPage", () => {
  it("shows the answer and a verdict form, and never a person", async () => {
    rpc.mockResolvedValue({ data: [{ sample_id: "11111111-1111-4111-8111-111111111111", system_code: "AI-001", sample_month: "2026-10-01", sampled_by_rule: "flagged", output_summary: "A general explanation.", created_at: "2026-10-07T10:00:00Z" }], error: null });
    render(await AiReviewPage(props()));
    expect(screen.getByText("A general explanation.")).toBeTruthy();
    expect(screen.getByText("Save verdict")).toBeTruthy();
    expect(screen.getByText(/Flagged/)).toBeTruthy();
  });
  it("empty means nothing waiting, an error means could not load", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(await AiReviewPage(props()));
    expect(screen.getByText("Nothing waiting for review.")).toBeTruthy();
  });
  it("a failed load is an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    render(await AiReviewPage(props()));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
  });
  it("sends a non-reviewer back to /clinician", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    await expect(AiReviewPage(props())).rejects.toThrow("REDIRECT:/clinician");
  });
});
