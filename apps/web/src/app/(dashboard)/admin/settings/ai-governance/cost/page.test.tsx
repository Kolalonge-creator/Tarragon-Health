/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me" }) }));
jest.mock("@/lib/auth/permissions", () => ({ getCallerPermissions: jest.fn().mockResolvedValue({ isSuperAdmin: false, keys: new Set(["ai_governance.manage"]) }) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import AiCostPage from "./page";

const row = { system_code: "AI-002", system_name: "Lifestyle nudge proposer", model_identifier: "m", currency: null, interactions: 3, input_tokens: 100, output_tokens: 50, priced_interactions: 0, cost_millionths_minor: null };
const props = () => ({ searchParams: Promise.resolve({}) });
beforeEach(() => rpc.mockReset());

describe("AiCostPage", () => {
  it("shows No price, never a number, when no price exists", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    render(await AiCostPage(props()));
    expect(screen.getByText("No price")).toBeTruthy();
  });
  it("shows an exact cost where a price exists", async () => {
    rpc.mockResolvedValue({ data: [{ ...row, currency: "USD", priced_interactions: 3, cost_millionths_minor: 1_050_000 }], error: null });
    render(await AiCostPage(props()));
    expect(screen.getByText(/0\.0105 USD/)).toBeTruthy();
  });
  it("a failed load is an error, never an empty table", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "XX000" } });
    render(await AiCostPage(props()));
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("a refusal leaves the page", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    await expect(AiCostPage(props())).rejects.toThrow("REDIRECT:/admin");
  });
});
