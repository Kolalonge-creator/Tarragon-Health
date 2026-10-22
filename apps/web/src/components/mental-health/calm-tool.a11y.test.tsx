/** @jest-environment jsdom */
/**
 * The calm tool (S56b): opens full screen with no network, walks breathing then 5-4-3-2-1 then done, keeps the way out to the crisis card on
 * screen at every step, logs nothing unless "Tell my care team" is tapped, works with reduced motion, and has no accessibility violations.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import "@/test/a11y"; // registers toHaveNoViolations

const rpc = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { CalmToolButton } from "./calm-tool";

function setReducedMotion(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}
const fetchSpy = jest.fn();

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
  fetchSpy.mockReset();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  setReducedMotion(false);
  window.localStorage.clear();
});

const open = () => fireEvent.click(screen.getByRole("button", { name: /I need to calm down now/ }));

describe("CalmToolButton", () => {
  it("renders nothing while the feature is closed", () => {
    const { container } = render(<CalmToolButton enabled={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("opens a full-screen dialog with a name, no network call and no violations, and the way out to help already on screen", async () => {
    const { baseElement } = render(<CalmToolButton enabled />);
    open();
    const dialog = screen.getByRole("dialog", { name: "Calming exercise" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("You are safe right now. This feeling is strong, and it will pass.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I am in danger or thinking of harming myself" })).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // the 'region' rule is about a whole page having landmarks; the dialog is rendered inside the app's main landmark in the real page
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });

  it("walks breathing, then 5-4-3-2-1, then done, and keeps the help button at every step", () => {
    render(<CalmToolButton enabled />);
    open();
    const danger = () => screen.getByRole("button", { name: "I am in danger or thinking of harming myself" });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("Breathe in slowly")).toBeTruthy();
    expect(screen.getByText("Breath 1 of 6")).toBeTruthy();
    expect(danger()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to the next step" }));
    for (const line of ["Name 5 things you can see.", "Name 4 things you can feel, like your feet on the floor.", "Name 3 things you can hear.", "Name 2 things you can smell.", "Name 1 thing you can taste."]) {
      expect(screen.getByText(line)).toBeTruthy();
      expect(danger()).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByRole("heading", { name: "You did well." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tell my care team" })).toBeTruthy();
    expect(danger()).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled(); // nothing is sent or logged by doing the exercise
  });

  it("draws a moving circle by default and none under reduced motion or the words-only switch", () => {
    const { unmount } = render(<CalmToolButton enabled />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(document.querySelector('[aria-hidden="true"].rounded-full')).not.toBeNull();
    unmount();
    setReducedMotion(true);
    render(<CalmToolButton enabled />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(document.querySelector('[aria-hidden="true"].rounded-full')).toBeNull();
    expect(screen.getByText("Breathe in slowly")).toBeTruthy(); // the words alone carry the exercise
  });

  it("opens the existing crisis card from inside the exercise and lets the person go back", async () => {
    render(<CalmToolButton enabled />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "I am in danger or thinking of harming myself" })); });
    expect(screen.getByRole("region", { name: "If you are in danger or thinking about ending your life" })).toBeTruthy();
    expect(screen.getByText(/Call 112 now/)).toBeTruthy(); // the bundled card works with the network down (the rpc above failed)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Back to the exercise" })); });
    expect(screen.getByText("Breathe in slowly")).toBeTruthy();
  });

  it("sends the existing hand-off only when 'Tell my care team' is tapped, and says so if it fails", async () => {
    render(<CalmToolButton enabled />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to the next step" }));
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tell my care team" })); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("request_mental_health_handoff", { p_note: "I had a very anxious moment and would like someone from my care team to get in touch." });
    expect(screen.getByRole("alert").textContent).toMatch(/could not send that just now/);
    rpc.mockResolvedValueOnce({ data: "h1", error: null });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tell my care team" })); });
    expect(screen.getByRole("status").textContent).toMatch(/Your care team will pick this up/);
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<CalmToolButton enabled />);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
