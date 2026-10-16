/** @jest-environment jsdom */
/**
 * S29e: the patient's side of a supporter's non-emergency check-in request. Shown only while a question is waiting; one tap answers
 * it; it never says who asked. Axe-clean.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CheckInCard } from "./check-in-card";

let pending: { data: boolean; isError?: boolean };
const respond = jest.fn();
let respondState: { isPending: boolean; isError: boolean };
jest.mock("@/lib/queries/care-circle", () => ({
  useCheckInPending: () => pending,
  useRespondCheckIn: () => ({ mutateAsync: respond, ...respondState }),
}));

beforeEach(() => {
  pending = { data: true };
  respondState = { isPending: false, isError: false };
  respond.mockReset();
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
});
