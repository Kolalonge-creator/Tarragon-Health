/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const draftDoc = jest.fn();
const accept = jest.fn();
jest.mock("@/lib/scribe/actions", () => ({
  draftScribeDocument: (...a: unknown[]) => draftDoc(...a),
  acceptFollowUpTaskProposal: (...a: unknown[]) => accept(...a),
}));

import { DocumentDraftsPanel } from "./document-drafts-panel";

const facts = [{ id: "f1", type: "plan_item" as const, text: "Review in 2 weeks", quote: "two weeks", speaker: "clinician" as const }];
const renderPanel = () =>
  render(<DocumentDraftsPanel patientId="p1" noteId="n1" consentId="c1" facts={facts} />);

beforeEach(() => {
  draftDoc.mockReset();
  accept.mockReset();
});

describe("DocumentDraftsPanel", () => {
  it("says the kind is not switched on when the prompt has not been approved, and shows no draft", async () => {
    draftDoc.mockResolvedValue({ status: "disabled", reason: "prompt_not_approved" });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "A letter" }));
    await screen.findByText(/not switched on yet/);
    expect(screen.queryByTestId("watermark")).toBeNull();
  });

  it("a prescription proposal is watermarked, says nothing was prescribed, and has no create button", async () => {
    draftDoc.mockResolvedValue({
      status: "ok",
      modelId: "m",
      promptVersion: "p",
      document: { kind: "prescription_proposal", dropped: 1, items: [{ medicine: "Amlodipine", dose: "5 mg", frequency: "once daily", duration: "", reason: "BP", sourceFactId: "f1" }] },
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Medicines to consider/ }));
    await screen.findByText(/Amlodipine, 5 mg, once daily/);
    expect(screen.getByTestId("watermark").textContent).toBe("AI-drafted, unsigned");
    expect(screen.getByText(/Nothing has been prescribed/)).toBeTruthy();
    expect(screen.getByText(/1 item\(s\) were left out/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /prescri/i })).toBeNull();
  });

  it("a task creates a follow-up only when accepted", async () => {
    draftDoc.mockResolvedValue({ status: "ok", modelId: "m", promptVersion: "p", document: { kind: "follow_up_tasks", dropped: 0, items: [{ description: "Review blood pressure", dueInDays: 14, sourceFactId: "f1" }] } });
    accept.mockResolvedValue({ ok: true });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Follow-up tasks" }));
    await screen.findByText(/Review blood pressure/);
    expect(accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Accept and create follow-up" }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith({ patientId: "p1", dueInDays: 14 }));
    await screen.findByText("Follow-up created.");
  });

  it("dismissing a task creates nothing", async () => {
    draftDoc.mockResolvedValue({ status: "ok", modelId: "m", promptVersion: "p", document: { kind: "follow_up_tasks", dropped: 0, items: [{ description: "Call the patient", dueInDays: 3, sourceFactId: "f1" }] } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Follow-up tasks" }));
    await screen.findByText(/Call the patient/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Call the patient/)).toBeNull();
    expect(accept).not.toHaveBeenCalled();
  });

  it("a letter is watermarked and editable", async () => {
    draftDoc.mockResolvedValue({ status: "ok", modelId: "m", promptVersion: "p", document: { kind: "letter", body: "Dear patient" } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "A letter" }));
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(box.value).toBe("Dear patient");
    expect(screen.getByTestId("watermark")).toBeTruthy();
  });
});
