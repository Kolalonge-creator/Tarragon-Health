/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { nextSteps } from "@/lib/translations/model";

const result = jest.fn();
const chain = { select: () => chain, order: () => result() };
jest.mock("next/navigation", () => ({ redirect: (p: string) => { throw new Error(`REDIRECT:${p}`); } }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: jest.fn().mockResolvedValue({ id: "me", language: "en" }) }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ from: () => chain }) }));

import TranslationsPage from "./page";
const props = (n?: string) => ({ searchParams: Promise.resolve({ n }) });
beforeEach(() => result.mockReset());

describe("nextSteps mirrors the database state machine", () => {
  it("cannot skip native review, and reaching clinical review is only from native_reviewed", () => {
    expect(nextSteps("draft")).toEqual(["native_reviewed"]);
    expect(nextSteps("native_reviewed")).toEqual(["clinical_reviewed", "draft"]);
    expect(nextSteps("clinical_reviewed")).toEqual(["draft"]);
  });
});

describe("TranslationsPage", () => {
  it("says English is the only language when there are no rows", async () => {
    result.mockReturnValue({ data: [], error: null });
    render(await TranslationsPage(props()));
    expect(screen.getByText(/English is the only language\./)).toBeTruthy();
  });
  it("offers the CMO step on a natively reviewed clinical row", async () => {
    result.mockReturnValue({ data: [{ id: "11111111-1111-4111-8111-111111111111", key: "emergency.x", language: "zz", is_clinical: true, state: "native_reviewed", reviewed_at: null }], error: null });
    render(await TranslationsPage(props()));
    expect(screen.getByText(/Mark clinically reviewed/)).toBeTruthy();
  });
  it("a failed load is an error, not an empty list", async () => {
    result.mockReturnValue({ data: null, error: { message: "boom", code: "XX000" } });
    render(await TranslationsPage(props()));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
  });
});
