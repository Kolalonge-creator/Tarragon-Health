/** @jest-environment jsdom */
/**
 * INV-06 on the web (S85b): with the network off, a red reading or a ticked emergency symptom shows the emergency guidance from bundled code
 * at once, the reading is never claimed saved, and nothing is sent. A normal reading offline keeps the plain refuse-to-save message only.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { activeWording } from "@tarragon/i18n";
import { expectNoA11yViolations } from "@/test/a11y";
import { OFFLINE_UNCONFIRMED_TITLE } from "@/lib/vitals/offline-emergency";
import { EMERGENCY_MARKER_KEY, readEmergency } from "@/lib/vitals/emergency-marker";
import { SUBMIT_UNANSWERED_MS, VitalsForm } from "./vitals-form";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockLogVital = jest.fn<Promise<unknown>, []>(async () => undefined);
jest.mock("./actions", () => ({
  logVital: () => mockLogVital(),
}));

let mockIsOnline = false;
jest.mock("@/lib/network/use-online-status", () => ({
  useOnlineStatus: () => mockIsOnline,
}));

function fill(sys: string, dia: string) {
  fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: sys } });
  fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: dia } });
}

describe("VitalsForm offline emergency guidance", () => {
  beforeEach(() => {
    mockLogVital.mockReset();
    mockLogVital.mockImplementation(async () => undefined);
    mockIsOnline = false;
    window.sessionStorage.clear();
  });

  it("a very high reading offline shows the signed emergency wording, says it was not saved, and calls nothing", () => {
    render(<VitalsForm patientId="p1" />);
    fill("210", "125");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(activeWording("EMG-001").title);
    expect(dialog.textContent).toContain(activeWording("EMG-001").body);
    expect(screen.getByTestId("offline-not-saved").textContent).toMatch(/has not been saved/i);
    expect(screen.queryByText(/Received by TarragonHealth/)).toBeNull();
    expect(mockLogVital).not.toHaveBeenCalled();
  });

  it("ticking an emergency symptom offline shows the guidance immediately, before any submit", () => {
    render(<VitalsForm patientId="p1" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByLabelText("Chest pain or pressure"));
    expect(screen.getByRole("alertdialog").textContent).toContain(activeWording("EMG-001").body);
  });

  it("closing the guidance returns to the form, which still refuses to save", () => {
    render(<VitalsForm patientId="p1" />);
    fill("210", "125");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
    expect(mockLogVital).not.toHaveBeenCalled();
  });

  it("a normal reading offline shows no emergency dialog, only the offline message", () => {
    render(<VitalsForm patientId="p1" />);
    fill("118", "76");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
  });

  it("online there are no symptom ticks and no offline dialog", () => {
    mockIsOnline = true;
    render(<VitalsForm patientId="p1" />);
    expect(screen.queryByTestId("offline-symptoms")).toBeNull();
    fill("210", "125");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    expect(screen.queryByTestId("offline-emergency-guidance")).toBeNull();
  });

  it("the open dialog passes axe", async () => {
    const view = await expectNoA11yViolations(<VitalsForm patientId="p1" />);
    fireEvent.click(view.getByLabelText("Chest pain or pressure"));
    expect(view.getByRole("alertdialog")).toBeTruthy();
    const { axe } = await import("jest-axe");
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the guidance code and the symptoms offered come from the engine", () => {
  beforeEach(() => {
    mockLogVital.mockReset();
    mockIsOnline = false;
    window.sessionStorage.clear();
  });

  it("80/50 with confusion offline shows the EMG-001L wording, not EMG-001", () => {
    render(<VitalsForm patientId="p1" />);
    fill("80", "50");
    // ticking confusion alone is an emergency (red-flag symptom), so the dialog opens at once with the engine's code for the symptom alone
    fireEvent.click(screen.getByLabelText("Confusion or drowsiness"));
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(activeWording("EMG-001L").title);
    expect(dialog.textContent).toContain(activeWording("EMG-001L").body);
    expect(dialog.textContent).not.toContain(activeWording("EMG-001").body);
    expect(readEmergency()).toBe("EMG-001L");
  });

  it("offers the symptoms the server treats as emergencies that the first version left out (chest pain, weakness, speech, a fit, passing out, fainting)", () => {
    render(<VitalsForm patientId="p1" />);
    for (const label of ["Weakness or numbness", "Trouble speaking", "A fit (convulsion)", "Passing out", "Fainting or nearly fainting", "Chest pain or pressure"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("a pregnancy-severe reading with no flag shows the guidance offline", () => {
    render(<VitalsForm patientId="p1" />);
    fill("165", "105");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    expect(screen.getByRole("alertdialog").textContent).toContain(activeWording("EMG-001").body);
  });

  it("fainting alone does not open the dialog (it is only an emergency beside a low reading)", () => {
    render(<VitalsForm patientId="p1" />);
    fireEvent.click(screen.getByLabelText("Fainting or nearly fainting"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

// React finishes an action's result in a later task than the promise that carried it; with fake timers that task needs a nudge.
async function settle() {
  await act(async () => {
    await Promise.resolve();
    jest.advanceTimersByTime(50);
    await Promise.resolve();
  });
}

describe("a reading sent online that is never answered (lie-fi)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLogVital.mockReset();
    mockIsOnline = true;
    window.sessionStorage.clear();
  });
  // React holds every later transition until all async actions have settled, so a request left hanging by one test would freeze the next test's
  // updates. Each hanging request is therefore released when its test ends (as a real one eventually is).
  const hung: Array<(v: unknown) => void> = [];
  const hang = () => new Promise((resolve) => hung.push(resolve));
  afterEach(async () => {
    await act(async () => {
      hung.splice(0).forEach((release) => release(undefined));
    });
    jest.useRealTimers();
  });

  function submit(sys: string, dia: string) {
    fill(sys, dia);
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    const confirm = screen.queryByRole("button", { name: /yes, this reading is correct/i });
    if (confirm) fireEvent.click(confirm);
  }

  it("shows the bundled guidance after the limit, says it could not confirm the save, and leaves the request alone", async () => {
    mockLogVital.mockImplementation(hang);
    render(<VitalsForm patientId="p1" />);
    submit("210", "125");
    expect(mockLogVital).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.sessionStorage.getItem(EMERGENCY_MARKER_KEY)).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(SUBMIT_UNANSWERED_MS + 50);
    });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(activeWording("EMG-001").body);
    expect(screen.getByTestId("offline-not-saved").textContent).toContain(OFFLINE_UNCONFIRMED_TITLE);
    expect(screen.getByTestId("offline-not-saved").textContent).not.toMatch(/nothing was sent/i);
  });

  it("does not wait for the limit if the server answers in time: no dialog, and the note is cleared", async () => {
    const answer = (v: unknown) => hung.splice(0).forEach((release) => release(v));
    mockLogVital.mockImplementation(hang);
    render(<VitalsForm patientId="p1" />);
    submit("210", "125");
    await act(async () => {
      jest.advanceTimersByTime(1000);
      answer({ success: true, bpAckLevel: "emergency" });
    });
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(SUBMIT_UNANSWERED_MS * 2);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(readEmergency()).toBeNull();
  });

  it("closes the not-confirmed dialog when the answer finally arrives", async () => {
    const answer = (v: unknown) => hung.splice(0).forEach((release) => release(v));
    mockLogVital.mockImplementation(hang);
    render(<VitalsForm patientId="p1" />);
    submit("210", "125");
    await act(async () => {
      jest.advanceTimersByTime(SUBMIT_UNANSWERED_MS + 50);
    });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await act(async () => {
      answer({ success: true, bpAckLevel: "emergency" });
    });
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(readEmergency()).toBeNull();
  });

  it("a reading that does not meet the check shows nothing even if the request hangs", async () => {
    mockLogVital.mockImplementation(hang);
    render(<VitalsForm patientId="p1" />);
    submit("118", "76");
    await act(async () => {
      jest.advanceTimersByTime(SUBMIT_UNANSWERED_MS * 3);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.sessionStorage.getItem(EMERGENCY_MARKER_KEY)).toBeNull();
  });

  it("sabotage: with the limit not waited out the dialog is not there, so the checks above can fail", async () => {
    mockLogVital.mockImplementation(hang);
    render(<VitalsForm patientId="p1" />);
    submit("210", "125");
    await act(async () => {
      jest.advanceTimersByTime(SUBMIT_UNANSWERED_MS - 500);
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the guidance dialog behaves like a modal dialog (keyboard and assistive technology)", () => {
  beforeEach(() => {
    mockLogVital.mockReset();
    mockIsOnline = false;
    window.sessionStorage.clear();
  });

  function open() {
    const view = render(<VitalsForm patientId="p1" />);
    const trigger = screen.getByLabelText("Chest pain or pressure");
    trigger.focus();
    fireEvent.click(trigger);
    return { view, trigger, dialog: screen.getByRole("alertdialog") };
  }

  it("focus moves to the first button, and Tab and Shift+Tab stay inside the dialog", () => {
    const { dialog } = open();
    const button = screen.getByRole("button", { name: "I have read this" });
    expect(document.activeElement).toBe(button);
    expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(false); // default prevented: focus does not leave
    expect(fireEvent.keyDown(button, { key: "Tab", shiftKey: true })).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Shift+Tab with focus on the panel itself (not on a control) lands on a control inside, not behind the dialog", () => {
    const { dialog } = open();
    const panel = dialog.firstElementChild as HTMLElement;
    panel.tabIndex = -1;
    panel.focus();
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "I have read this" }));
  });

  it("the rest of the page is inert and hidden from assistive technology while it is open, and put back after", () => {
    const { view } = open();
    const pageRoot = view.container;
    expect(pageRoot.hasAttribute("inert")).toBe(true);
    expect(pageRoot.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    expect(pageRoot.hasAttribute("inert")).toBe(false);
    expect(pageRoot.hasAttribute("aria-hidden")).toBe(false);
  });

  it("does not remove an aria-hidden the page already had", () => {
    const other = document.createElement("div");
    other.setAttribute("aria-hidden", "true");
    document.body.appendChild(other);
    open();
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    expect(other.getAttribute("aria-hidden")).toBe("true");
    other.remove();
  });

  it("Escape closes it and focus goes back to the control that had it", () => {
    const { trigger, dialog } = open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closing with the button also restores focus", () => {
    const { trigger } = open();
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("the open dialog passes axe across the whole document, including the inert page behind it", async () => {
    open();
    const { axe } = await import("jest-axe");
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
