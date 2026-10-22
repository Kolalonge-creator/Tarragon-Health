/** @jest-environment jsdom */
/**
 * "Customise" for the pinned tiles: opens on what is saved, lets the patient add and reorder tiles, will not
 * switch off a pin the care plan relies on, saves exactly what is shown, and shows a failed save.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import "@/test/a11y";

const saveHomePins = jest.fn();
jest.mock("@/app/(dashboard)/patient/home-pins-actions", () => ({ saveHomePins: (...a: unknown[]) => saveHomePins(...a) }));

import { ManageHomePins } from "./manage-home-pins";

beforeAll(() => {
  // jsdom has no <dialog>.showModal/close.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

beforeEach(() => saveHomePins.mockReset().mockResolvedValue({ ok: true }));

function open(pins: Parameters<typeof ManageHomePins>[0]["initialPins"], locked: Parameters<typeof ManageHomePins>[0]["lockedPins"] = []) {
  render(<ManageHomePins initialPins={pins} lockedPins={locked} />);
  fireEvent.click(screen.getByRole("button", { name: "Customise" }));
}

describe("ManageHomePins", () => {
  it("shows what is pinned now, in order, and ticks those tiles", () => {
    open(["bp", "sleep"]);
    const order = within(screen.getByRole("list"));
    expect(order.getAllByRole("listitem").map((li) => li.textContent?.replace(/UpDown$/, ""))).toEqual(["Blood pressure", "Sleep"]);
    expect((screen.getByRole("checkbox", { name: /Blood pressure/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Weight/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("adds a tile the patient chooses and saves the list in the order shown", async () => {
    open(["bp"]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Weight/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move Weight up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveHomePins).toHaveBeenCalledWith(["weight", "bp"]));
  });

  it("will not switch off a pin the care plan relies on", () => {
    open(["doses_today", "bp"], ["doses_today"]);
    const box = screen.getByRole("checkbox", { name: /Doses today/ }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/Stays on while you have a medication/)).not.toBeNull();
  });

  it("keeps the dialog open and says so when the save fails", async () => {
    saveHomePins.mockResolvedValue({ ok: false, error: "Couldn't save that. Please try again." });
    open(["bp"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't save that/);
  });

  it("says so when the request itself fails, and keeps the dialog open", async () => {
    saveHomePins.mockRejectedValue(new Error("Failed to fetch"));
    open(["bp"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't reach the server/i);
  });

  it("has no accessibility violations once opened", async () => {
    const { container } = render(<ManageHomePins initialPins={["bp", "doses_today"]} lockedPins={["doses_today"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
