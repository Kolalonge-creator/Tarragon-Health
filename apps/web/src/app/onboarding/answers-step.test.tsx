/** @jest-environment jsdom */
/**
 * AnswersStep (S41, spec 1.10): the goal and condition choices. Pinned: "None of these" and "I am not sure yet" stand alone,
 * an empty answer is refused with an explanation, a good answer is reported exactly, and the derived intent for the
 * questionnaire intro follows the answers.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { AnswersStep, intentFromAnswers } from "./answers-step";

describe("AnswersStep", () => {
  it("reports the chosen goals and conditions", () => {
    const onComplete = jest.fn();
    render(<AnswersStep onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText("Managing a health condition"));
    fireEvent.click(screen.getByLabelText("High blood pressure"));
    fireEvent.click(screen.getByLabelText("Diabetes"));
    fireEvent.click(screen.getByText("Continue"));
    expect(onComplete).toHaveBeenCalledWith({ goals: ["manage_condition"], conditions: ["hypertension", "diabetes"] });
  });

  it("choosing 'None of these' clears the conditions, and choosing a condition clears 'None'", () => {
    render(<AnswersStep onComplete={jest.fn()} />);
    fireEvent.click(screen.getByLabelText("Diabetes"));
    fireEvent.click(screen.getByLabelText("None of these"));
    expect((screen.getByLabelText("Diabetes") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Asthma"));
    expect((screen.getByLabelText("None of these") as HTMLInputElement).checked).toBe(false);
  });

  it("choosing 'I am not sure yet' clears the other goals", () => {
    render(<AnswersStep onComplete={jest.fn()} />);
    fireEvent.click(screen.getByLabelText("A health check"));
    fireEvent.click(screen.getByLabelText("I am not sure yet"));
    expect((screen.getByLabelText("A health check") as HTMLInputElement).checked).toBe(false);
  });

  it("refuses an empty answer and says why", () => {
    const onComplete = jest.fn();
    render(<AnswersStep onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Choose at least one answer");
  });

  it("shows the words of the spoken help, and says audio is not ready", () => {
    render(<AnswersStep onComplete={jest.fn()} />);
    expect(screen.getByText(/Spoken help for this screen is not ready yet/)).toBeTruthy();
  });
});

describe("intentFromAnswers", () => {
  it("manage for a condition or a manage goal, prevent for staying ahead, otherwise unsure", () => {
    expect(intentFromAnswers({ goals: ["stay_ahead"], conditions: ["asthma"] })).toBe("manage");
    expect(intentFromAnswers({ goals: ["manage_condition"], conditions: ["none"] })).toBe("manage");
    expect(intentFromAnswers({ goals: ["screening_check"], conditions: ["none"] })).toBe("prevent");
    expect(intentFromAnswers({ goals: ["not_sure"], conditions: ["none"] })).toBe("unsure");
  });
});
