/** @jest-environment jsdom */
/**
 * S47a: the web entry card. After a save the card must settle (no render loop), give the next entry a fresh idempotency key, and forget the
 * "yes, the number is right" tick, so an unusual number next time asks again.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LifestyleLogCard } from "./lifestyle-log-card";

const logObservation = jest.fn();
const logInhalerUse = jest.fn();
jest.mock("./observation-actions", () => ({
  logObservation: (...a: unknown[]) => logObservation(...a),
  logInhalerUse: (...a: unknown[]) => logInhalerUse(...a),
}));

const keyOf = (container: HTMLElement) => (container.querySelector('input[name="client_reading_id"]') as HTMLInputElement).value;
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><LifestyleLogCard types={["water_ml", "sleep_hours"]} /></QueryClientProvider>);

describe("LifestyleLogCard", () => {
  beforeEach(() => {
    logObservation.mockReset();
    logInhalerUse.mockReset();
  });

  it("sends one idempotency key per entry and rotates it after a save, without a render loop", async () => {
    logObservation.mockResolvedValue({ success: true });
    const { container } = wrap();
    const first = keyOf(container);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.change(screen.getByLabelText("Water (ml)"), { target: { value: "250" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(logObservation).toHaveBeenCalledTimes(1);
    const sent = (logObservation.mock.calls[0]![1] as FormData).get("client_reading_id");
    expect(sent).toBe(first);
    expect(screen.getByText("Saved. Thank you.")).toBeTruthy();
    expect(keyOf(container)).not.toBe(first);
  });

  it("asks again for an unusual number after the previous one was confirmed and saved", async () => {
    logObservation.mockResolvedValueOnce({ confirm: "That is a lot of water at once. Tap Save again if the number is right." });
    logObservation.mockResolvedValueOnce({ success: true });
    logObservation.mockResolvedValueOnce({ confirm: "That is a lot of water at once. Tap Save again if the number is right." });
    const { container } = wrap();
    fireEvent.change(screen.getByLabelText("Water (ml)"), { target: { value: "2000" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    fireEvent.click(screen.getByLabelText("Yes, the number is right"));
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect((logObservation.mock.calls[1]![1] as FormData).get("confirm_unusual")).toBe("yes");
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    // the tick was forgotten after the save
    expect((logObservation.mock.calls[2]![1] as FormData).get("confirm_unusual")).not.toBe("yes");
  });
});
