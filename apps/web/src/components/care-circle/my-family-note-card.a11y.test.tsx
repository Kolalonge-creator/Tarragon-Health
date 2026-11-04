/** @jest-environment jsdom */
/**
 * The patient's own note card (patient-first release, 2026-11-03): a new note is private ("Only you can see this") until the patient
 * presses Share; "Don't share" and "Stop sharing" send share=false; an earlier shared note is shown with Stop sharing when the latest is
 * private; nothing renders with no notes; a failure says nothing changed. Axe-clean in each state.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { MyFamilyNoteCard } from "./my-family-note-card";

let notes: { isLoading: boolean; data: unknown[] | undefined };
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/care-circle", () => ({
  useMyFamilyNotes: () => notes,
  useSetFamilyNoteShared: () => ({ mutateAsync, isPending: false }),
}));

const N = (over: Record<string, unknown> = {}) => ({
  note_id: "6a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b",
  body: "Your mum did well today. Please help her keep walking each evening.",
  written_at: "2026-11-03T10:00:00Z",
  author_staff_id: "s1",
  author_name: "Dr Amara Eze",
  shared: false,
  decided: false,
  ...over,
});

beforeEach(() => {
  notes = { isLoading: false, data: [N()] };
  mutateAsync.mockReset();
});

describe("MyFamilyNoteCard", () => {
  it("a new note is private, names the doctor, and offers Share and Don't share; axe-clean", async () => {
    await expectNoA11yViolations(<MyFamilyNoteCard locale="en" />);
    expect(screen.getByRole("heading", { name: "A note from the doctor for your family" })).toBeTruthy();
    expect(screen.getByText("Only you can see this")).toBeTruthy();
    expect(screen.getByText("From Dr Amara Eze")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share with my Care Circle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Don't share" })).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("Share sends share=true for that note and confirms", async () => {
    mutateAsync.mockResolvedValue(true);
    render(<MyFamilyNoteCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share with my Care Circle" })));
    expect(mutateAsync).toHaveBeenCalledWith({ noteId: N().note_id, share: true });
    expect(screen.getByRole("status").textContent).toMatch(/^Shared\./);
  });

  it("Don't share sends share=false and says only the patient can see it", async () => {
    mutateAsync.mockResolvedValue(false);
    render(<MyFamilyNoteCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Don't share" })));
    expect(mutateAsync).toHaveBeenCalledWith({ noteId: N().note_id, share: false });
    expect(screen.getByRole("status").textContent).toMatch(/Only you can see it/);
  });

  it("a shared note says so and offers Stop sharing only", async () => {
    notes = { isLoading: false, data: [N({ shared: true, decided: true })] };
    await expectNoA11yViolations(<MyFamilyNoteCard locale="en" />);
    expect(screen.getByText("Shared with your Care Circle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Share with my Care Circle" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeTruthy();
  });

  it("after Don't share, the card stops asking twice (no second Don't share)", () => {
    notes = { isLoading: false, data: [N({ decided: true })] };
    render(<MyFamilyNoteCard locale="en" />);
    expect(screen.queryByRole("button", { name: "Don't share" })).toBeNull();
    expect(screen.getByRole("button", { name: "Share with my Care Circle" })).toBeTruthy();
  });

  it("when the latest is private, an earlier shared note is shown with Stop sharing", async () => {
    const older = N({ note_id: "7b2f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b", body: "Earlier line.", shared: true, decided: true });
    notes = { isLoading: false, data: [N(), older] };
    mutateAsync.mockResolvedValue(false);
    await expectNoA11yViolations(<MyFamilyNoteCard locale="en" />);
    expect(screen.getByText("An earlier note your Care Circle can still see")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop sharing" })));
    expect(mutateAsync).toHaveBeenCalledWith({ noteId: older.note_id, share: false });
  });

  it("a failure says nothing changed", async () => {
    mutateAsync.mockRejectedValue(new Error("x"));
    render(<MyFamilyNoteCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share with my Care Circle" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Nothing changed/);
  });

  it("renders nothing with no notes, and a labelled skeleton while loading", () => {
    notes = { isLoading: false, data: [] };
    const { container, rerender } = render(<MyFamilyNoteCard locale="en" />);
    expect(container.textContent).toBe("");
    notes = { isLoading: true, data: undefined };
    rerender(<MyFamilyNoteCard locale="en" />);
    expect(screen.getByRole("status", { name: "Loading the note from the doctor" })).toBeTruthy();
  });

  it("every button is at least 44px tall and the copy has no em dash", () => {
    const { container } = render(<MyFamilyNoteCard locale="en" />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("min-h-11");
    expect(container.textContent).not.toContain("—");
  });
});
