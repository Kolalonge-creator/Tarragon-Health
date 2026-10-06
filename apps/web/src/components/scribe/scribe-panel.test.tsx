/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getState = jest.fn();
const recordConsent = jest.fn();
jest.mock("@/lib/scribe/actions", () => ({
  getScribeConsentState: (...a: unknown[]) => getState(...a),
  recordScribeConsent: (...a: unknown[]) => recordConsent(...a),
  revokeScribeConsent: jest.fn(),
  draftScribeFromText: jest.fn(),
}));

import { ScribePanel } from "./scribe-panel";

const noteId = "11111111-1111-4111-8111-111111111111";
const renderPanel = () => render(<ScribePanel patientId="22222222-2222-4222-8222-222222222222" encounterNoteId={noteId} onUseDraft={jest.fn()} />);

beforeEach(() => {
  getState.mockReset();
  recordConsent.mockReset();
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
});
