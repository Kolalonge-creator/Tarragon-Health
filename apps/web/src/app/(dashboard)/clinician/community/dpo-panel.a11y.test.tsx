/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { DpoRecipientsPanel } from "./dpo-panel";

const PERSON = "55555555-5555-4555-8555-555555555555";
const candidates = [{ profile_id: PERSON, name: "Ada Okafor", role: "care_coordinator" }];

describe("DpoRecipientsPanel", () => {
  it("has no accessibility violations, empty or filled", async () => {
    const onSet = jest.fn().mockResolvedValue({ ok: true, message: "Added." });
    await expectNoA11yViolations(<DpoRecipientsPanel recipients={[]} candidates={candidates} onSet={onSet} />);
    await expectNoA11yViolations(
      <DpoRecipientsPanel recipients={[{ profile_id: PERSON, name: "Ada Okafor", set_at: "2026-10-12T10:00:00Z" }]} candidates={[]} onSet={onSet} />,
    );
  });
  it("says plainly that only the CMO is told when the list is empty, and that it is optional", () => {
    render(<DpoRecipientsPanel recipients={[]} candidates={candidates} onSet={jest.fn()} />);
    expect(screen.getByText(/Only you\./)).toBeTruthy();
    expect(screen.getByText(/optional and does not hold anything up/)).toBeTruthy();
  });
  it("keeps Add disabled until someone is chosen, then adds that person", async () => {
    const onSet = jest.fn().mockResolvedValue({ ok: true, message: "Added." });
    render(<DpoRecipientsPanel recipients={[]} candidates={candidates} onSet={onSet} />);
    const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Add someone"), { target: { value: PERSON } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(onSet).toHaveBeenCalledWith({ profileId: PERSON, on: true }));
  });
  it("removes a person", async () => {
    const onSet = jest.fn().mockResolvedValue({ ok: true, message: "Removed." });
    render(<DpoRecipientsPanel recipients={[{ profile_id: PERSON, name: "Ada Okafor", set_at: "2026-10-12T10:00:00Z" }]} candidates={[]} onSet={onSet} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onSet).toHaveBeenCalledWith({ profileId: PERSON, on: false }));
  });
});
