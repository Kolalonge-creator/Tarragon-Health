/** @jest-environment jsdom */
/**
 * IntentStep is onboarding's new first step (see onboarding-flow.tsx's
 * resequencing comment): a tap-to-advance choice, not a form. Proves each
 * option reports the exact intent value onboarding-flow.tsx's
 * INTENT_TO_RISK_ASSESSMENT_STEP map keys off — a label/value drift here
 * would silently fall through to the "unsure" default for every visitor.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { IntentStep } from "./intent-step";

describe("IntentStep", () => {
  it("reports 'manage' when the managing-a-condition option is chosen", () => {
    const onComplete = jest.fn();
    render(<IntentStep onComplete={onComplete} />);

    fireEvent.click(screen.getByText("I'm managing a condition"));

    expect(onComplete).toHaveBeenCalledWith("manage");
  });

  it("reports 'prevent' when the stay-ahead option is chosen", () => {
    const onComplete = jest.fn();
    render(<IntentStep onComplete={onComplete} />);

    fireEvent.click(screen.getByText("I want to stay ahead of problems"));

    expect(onComplete).toHaveBeenCalledWith("prevent");
  });

  it("reports 'unsure' when the not-sure option is chosen", () => {
    const onComplete = jest.fn();
    render(<IntentStep onComplete={onComplete} />);

    fireEvent.click(screen.getByText("I'm not sure yet"));

    expect(onComplete).toHaveBeenCalledWith("unsure");
  });
});
