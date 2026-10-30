/** @jest-environment jsdom */
/**
 * S29e: the patient's side of a supporter's non-emergency check-in request. Shown only while a question is waiting; one tap answers
 * it; it never says who asked. Axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CheckInCard } from "./check-in-card";

let pending: { data: boolean; isError?: boolean };
let enabled: { data: boolean | undefined } = { data: true };
const respond = jest.fn();
let respondState: { isPending: boolean; isError: boolean };
jest.mock("@/lib/queries/care-circle", () => ({
  useCheckInEnabled: () => enabled,
  useCheckInPending: () => pending,
  useRespondCheckIn: () => ({ mutateAsync: respond, ...respondState }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  enabled = { data: true };
  pending = { data: true };
  respondState = { isPending: false, isError: false };
  respond.mockReset();
});

describe("CheckInCard snooze (UI-B)", () => {
  it("offers one snooze, then asks again in gentler words with no second snooze", async () => {
    jest.useFakeTimers();
    render(<CheckInCard locale="en" />);
    expect(screen.getByText(/may be told/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not right now" })));
    expect(screen.queryByRole("button", { name: "I am fine" })).toBeNull();
    expect(respond).not.toHaveBeenCalled();
    // The snooze is sized against the SHORTEST window the server allows (1 minute): a quarter of it, 15 seconds, never the full 5.
    await act(async () => { jest.advanceTimersByTime(14_000); });
    expect(screen.queryByRole("button", { name: "I am fine" })).toBeNull();
    await act(async () => { jest.advanceTimersByTime(1_000); });
    expect(screen.getByText("No problem. Want to answer now?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I am fine" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not right now" })).toBeNull();
    jest.useRealTimers();
  });

  it("a reload during or after the snooze cannot take a second snooze", async () => {
    const first = render(<CheckInCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not right now" })));
    first.unmount();
    // reloaded while snoozed: still hidden
    const during = render(<CheckInCard locale="en" />);
    expect(screen.queryByRole("button", { name: "I am fine" })).toBeNull();
    during.unmount();
    // reloaded after the snooze ended: asked again, and no second snooze offered
    window.sessionStorage.setItem("tarragon.checkin.snooze_until", String(Date.now() - 1_000));
    render(<CheckInCard locale="en" />);
    expect(screen.getByText("No problem. Want to answer now?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not right now" })).toBeNull();
  });

  it("the snooze tells nobody anything: no answer call is made", async () => {
    render(<CheckInCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not right now" })));
    expect(respond).not.toHaveBeenCalled();
  });

  it("is axe-clean with the snooze button showing", async () => {
    await expectNoA11yViolations(<CheckInCard locale="en" />);
  });
});

describe("CheckInCard", () => {
  it("is absent when nothing is waiting (so absent while the go-live is off)", () => {
    pending = { data: false };
    const { container } = render(<CheckInCard locale="en" />);
    expect(container.textContent).toBe("");
  });

  it("asks neutrally, with one button, and names nobody", async () => {
    render(<CheckInCard locale="en" />);
    expect(screen.getByText("Someone would like to hear from you")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I am fine" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/blood|pressure|reading|emergency|critical/i);
    cleanup();
    await expectNoA11yViolations(<CheckInCard locale="en" />);
  });

  it("answers with one tap and says nobody else was told", async () => {
    respond.mockResolvedValue(true);
    render(<CheckInCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I am fine" })));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toMatch(/Nobody else has been told/);
  });

  it("a failed answer is shown, not swallowed", async () => {
    respond.mockRejectedValue(new Error("x"));
    respondState = { isPending: false, isError: true };
    render(<CheckInCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I am fine" })));
    expect(screen.getByText(/did not go through/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("an answer that arrives after the question ended does not claim nobody was told", async () => {
    respond.mockResolvedValue(false);
    render(<CheckInCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I am fine" })));
    const msg = screen.getByRole("status").textContent ?? "";
    expect(msg).toMatch(/may have been told/);
    expect(msg).not.toMatch(/Nobody else has been told/);
  });

  it("a failed read says so instead of looking like nothing is waiting", () => {
    pending = { data: false, isError: true };
    render(<CheckInCard locale="en" />);
    expect(screen.getByRole("status").textContent).toMatch(/could not check/);
  });

  it("a later question shows the button again after an earlier answer", async () => {
    respond.mockResolvedValue(true);
    const { rerender } = render(<CheckInCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I am fine" })));
    expect(screen.queryByRole("button", { name: "I am fine" })).toBeNull();
    pending = { data: false };
    rerender(<CheckInCard locale="en" />);
    pending = { data: true };
    rerender(<CheckInCard locale="en" />);
    expect(screen.getByRole("button", { name: "I am fine" })).toBeTruthy();
  });

  it("one failed poll while a question is waiting keeps the button (the timer is still running)", () => {
    pending = { data: true, isError: true };
    render(<CheckInCard locale="en" />);
    expect(screen.getByRole("button", { name: "I am fine" })).toBeTruthy();
    expect(screen.getByText(/could not check/)).toBeTruthy();
  });

  it("the thank-you clears by itself, since the card lives in the layout", async () => {
    jest.useFakeTimers();
    respond.mockResolvedValue(true);
    render(<CheckInCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I am fine" })));
    expect(screen.getByRole("status").textContent).toMatch(/Nobody else has been told/);
    await act(async () => { jest.advanceTimersByTime(11_000); });
    expect(screen.queryByRole("status")).toBeNull();
    jest.useRealTimers();
  });

  it("when the go-live cannot be read (or the app is ahead of its database) a failed poll stays silent", () => {
    enabled = { data: undefined };
    pending = { data: false, isError: true };
    const { container } = render(<CheckInCard locale="en" />);
    expect(container.textContent).toBe("");
  });
});
