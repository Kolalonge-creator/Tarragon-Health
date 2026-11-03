/** @jest-environment jsdom */
/**
 * The doctor's "line for the family" form (2026-11-03): optional, shows the plain-words hint and a live count, refuses an empty or
 * over-long line on screen without calling the server, saves through the server action, shows the latest saved line, and maps a refusal
 * to a plain message. Axe-clean.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { FamilyNoteForm } from "./family-note-form";

const save = jest.fn();
jest.mock("@/lib/consultations/family-note-actions", () => ({ saveFamilyNoteAction: (...a: unknown[]) => save(...a) }));

const ENC = "0b3a9f2e-6f1c-4c8e-9a51-7d2c1e4b5f60";
beforeEach(() => save.mockReset());

describe("FamilyNoteForm", () => {
  it("is optional, shows the hint and the count, and is axe-clean", async () => {
    await expectNoA11yViolations(<FamilyNoteForm encounterId={ENC} latest={null} locale="en" />);
    expect(screen.getByText("Optional")).toBeTruthy();
    expect(screen.getByText("Plain words. No results, diagnoses or medicine names.")).toBeTruthy();
    expect(screen.getByText("0 of 280 characters")).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Write one short line the family can read" });
    expect(box.getAttribute("aria-describedby")).toContain("hint");
  });

  it("refuses an empty or over-long line without calling the server", async () => {
    render(<FamilyNoteForm encounterId={ENC} latest={null} locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save the line" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Write something first/);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a".repeat(281) } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save the line" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Keep it to 280 characters/);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves, then shows the saved line and a confirmation", async () => {
    save.mockResolvedValue({ ok: true });
    render(<FamilyNoteForm encounterId={ENC} latest={null} locale="en" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "She did well today." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save the line" })));
    expect(save).toHaveBeenCalledWith({ encounterId: ENC, body: "She did well today." });
    expect(screen.getByText("She did well today.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Saved/);
  });

  it("shows the latest line already saved, and a refusal in plain words", async () => {
    save.mockResolvedValue({ ok: false, reason: "not_allowed" });
    render(<FamilyNoteForm encounterId={ENC} latest={{ body: "Earlier line.", created_at: "2026-11-03T10:00:00Z" }} locale="en" />);
    expect(screen.getByText("Earlier line.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save the line" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Only the doctor who held this consultation/);
  });
});
