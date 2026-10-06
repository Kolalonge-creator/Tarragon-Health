/** @jest-environment jsdom */
/**
 * Accessibility coverage for BRE-01 on the web: the safety card (shown before first use), the ready state with its three
 * length choices, and the safety card's wording in Pidgin. The running guide is a timer driven by the clock and is covered
 * by the pacer model's own tests in @tarragon/shared.
 */
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import "@/test/a11y"; // registers toHaveNoViolations

async function expectNoA11yViolations(container: HTMLElement) {
  expect(await axe(container)).toHaveNoViolations();
}
import { BreathingExercise } from "./breathing-exercise";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
beforeEach(() => window.localStorage.clear());

describe("BreathingExercise accessibility", () => {
  it("shows the safety card first, with no start button until it is acknowledged", async () => {
    const { container } = renderWith("en");
    expect(screen.getByText("Before you start")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("offers the three lengths once the card is acknowledged, and remembers it", async () => {
    const { container } = renderWith("en");
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(window.localStorage.getItem("breathing.safety_ack.v1")).toBe("1");
    await expectNoA11yViolations(container);
  });

  it("keeps the safety wording in English for a Pidgin speaker (held until signed)", () => {
    renderWith("pcm");
    expect(screen.getByText("Before you start")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I have read this" })).toBeTruthy();
  });

  it("says to keep taking medicines and never claims to lower blood pressure", () => {
    const { container } = renderWith("en");
    expect(container.textContent).toMatch(/Keep taking your medicines/);
    expect(container.textContent).not.toMatch(/lowers? (your )?blood pressure|treat/i);
  });
});

import { render } from "@testing-library/react";
function renderWith(locale: "en" | "pcm") {
  return render(<BreathingExercise locale={locale} />);
}
