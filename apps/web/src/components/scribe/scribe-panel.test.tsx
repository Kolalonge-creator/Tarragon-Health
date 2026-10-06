/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getState = jest.fn();
const recordConsent = jest.fn();
const findFacts = jest.fn();
const draftFromFacts = jest.fn();
jest.mock("@/lib/scribe/actions", () => ({
  getScribeConsentState: (...a: unknown[]) => getState(...a),
  recordScribeConsent: (...a: unknown[]) => recordConsent(...a),
  revokeScribeConsent: jest.fn(),
  findScribeFactsFromText: (...a: unknown[]) => findFacts(...a),
  draftScribeFromFacts: (...a: unknown[]) => draftFromFacts(...a),
}));

import { ScribePanel } from "./scribe-panel";

const noteId = "11111111-1111-4111-8111-111111111111";
const renderPanel = () => render(<ScribePanel patientId="22222222-2222-4222-8222-222222222222" encounterNoteId={noteId} onUseDraft={jest.fn()} />);

beforeEach(() => {
  getState.mockReset();
  recordConsent.mockReset();
  findFacts.mockReset();
  draftFromFacts.mockReset();
});

describe("ScribePanel consent gate", () => {
  it.each([
    ["no_consultation", /only offered during a consultation/],
    ["not_asked", /cannot answer for them/],
    ["declined", /declined AI note-taking/],
  ])("%s: shows why, offers no start button", async (state, message) => {
    getState.mockResolvedValue({ state });
    renderPanel();
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Start AI scribe/ })).toBeNull();
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("given but not live or switched off: blocked", async () => {
    getState.mockResolvedValue({ state: "given", may_start: false });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/not available right now/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Start AI scribe/ })).toBeNull();
  });

  it("a failed read starts nothing and says so", async () => {
    getState.mockRejectedValue(new Error("boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Nothing has been started/));
    expect(screen.queryByRole("button", { name: /Start AI scribe/ })).toBeNull();
  });

  it("given and startable: start records the clinician-side row and opens the input step", async () => {
    getState.mockResolvedValue({ state: "given", may_start: true });
    recordConsent.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Start AI scribe/ }));
    await waitFor(() => expect(recordConsent).toHaveBeenCalledWith(expect.objectContaining({ granted: true, encounterNoteId: noteId })));
  });

  it("the check can be repeated", async () => {
    getState.mockResolvedValueOnce({ state: "not_asked" }).mockResolvedValueOnce({ state: "given", may_start: true });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Check again/ }));
    await screen.findByRole("button", { name: /Start AI scribe/ });
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it("the full path: notes, facts, confirm, draft with grounding warnings, then the review step", async () => {
    getState.mockResolvedValue({ state: "given", may_start: true });
    recordConsent.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
    findFacts.mockResolvedValue({
      status: "ok",
      facts: [{ id: "f1", type: "symptom", text: "Headache.", quote: "headache", speaker: "patient" }],
      droppedUnverified: 0,
      modelId: "m",
      promptVersion: "scribe-facts-v1",
    });
    draftFromFacts.mockResolvedValue({
      status: "ok",
      draft: { history: "Headache.", examination: "", assessment: "", plan: "", followUp: "" },
      patientSummary: "You had a headache.",
      groundingWarnings: [{ section: "history", kind: "number_not_in_facts", detail: "14" }],
      modelId: "m",
      promptVersion: "scribe-facts-draft-v1",
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Start AI scribe/ }));
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "x".repeat(60) } });
    fireEvent.click(screen.getByRole("button", { name: "Find the facts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: /Write the draft/ }));
    await screen.findByText(/Check these points in the draft/);
    expect(screen.getByText(/contains the number 14/)).toBeTruthy();
    expect(draftFromFacts).toHaveBeenCalledWith(expect.objectContaining({ confirmedFacts: [expect.objectContaining({ id: "f1" })] }));
  });
});
