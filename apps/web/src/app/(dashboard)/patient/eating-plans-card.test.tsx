/** @jest-environment jsdom */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EatingView } from "@/lib/nutrition/eating-plans";

const load = jest.fn<() => Promise<EatingView>>();
jest.mock("./nutrition-actions", () => ({ loadEatingGuidanceAction: () => load() }));
jest.mock("@/lib/queries/food-catalogue", () => ({
  useFoodCatalogue: () => ({ data: [{ code: "fish_dried", name: "Dried/stock fish" }, { code: "fish_grilled", name: "Grilled fish" }] }),
}));

let mockBookable = true;
jest.mock("@/lib/queries/appointments", () => ({ useMyBookingTerms: () => ({ data: { bookable: mockBookable } }) }));

import { EatingPlansCard, signedSwapMessage } from "./eating-plans-card";

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EatingPlansCard />
    </QueryClientProvider>,
  );
}

const swap = {
  code: "dried_fish_to_grilled",
  fromFoodCode: "fish_dried",
  toFoodCodes: ["fish_grilled"],
  reasonKind: "less_salt" as const,
  reason: "Fresh grilled fish usually carries much less salt.",
  audience: ["hypertension" as const],
};
const plan = {
  code: "kidney" as const,
  title: "Eating well with kidney disease",
  intro: "A dietitian can build a plan.",
  tips: [{ heading: "Ask before you change", body: "Please ask first." }],
  careTeamPrompt: "Please talk to a dietitian or your care team.",
};

describe("EatingPlansCard", () => {
  beforeEach(() => {
    load.mockReset();
    mockBookable = true;
  });

  it("renders nothing at all when the database says unavailable (no empty card, no hint)", async () => {
    load.mockResolvedValue({ signed: true, guidance: { state: "unavailable" }, raw: null, failed: false });
    const { container } = renderCard();
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while the old fallback is in force (nothing signed yet)", async () => {
    load.mockResolvedValue({ signed: false, guidance: { state: "unavailable" }, raw: null, failed: false });
    const { container } = renderCard();
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("shows the plan with its care team prompt, a dietitian booking link and the swaps in words", async () => {
    load.mockResolvedValue({ signed: true, guidance: { state: "ok", configVersion: 1, plans: [plan], swaps: [swap] }, raw: null, failed: false });
    renderCard();
    expect(await screen.findByText("Eating well with kidney disease")).toBeTruthy();
    expect(screen.getByText("Please talk to a dietitian or your care team.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Book a dietitian visit" }).getAttribute("href")).toBe("/patient/appointments?type=dietitian");
    expect(screen.getByText("Less salt")).toBeTruthy();
    expect(screen.getByText(/You could try grilled fish instead of dried\/stock fish\./)).toBeTruthy();
  });

  it("shows no booking link while a dietitian visit cannot be booked (no dead end)", async () => {
    mockBookable = false;
    load.mockResolvedValue({ signed: true, guidance: { state: "ok", configVersion: 1, plans: [plan], swaps: [swap] }, raw: null, failed: false });
    renderCard();
    expect(await screen.findByText("Eating well with kidney disease")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Book a dietitian visit" })).toBeNull();
  });
});

describe("signedSwapMessage", () => {
  it("is an idea with a reason, never a verdict", () => {
    const text = signedSwapMessage(swap, [{ code: "fish_dried", name: "Dried fish" }, { code: "fish_grilled", name: "Grilled fish" }] as never);
    expect(text).toBe("You could try grilled fish instead of dried fish. Fresh grilled fish usually carries much less salt.");
    expect(text.toLowerCase()).not.toMatch(/\b(bad|avoid|never|don't eat)\b/);
  });
});
