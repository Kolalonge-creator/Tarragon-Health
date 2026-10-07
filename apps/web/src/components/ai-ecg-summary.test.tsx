/** @jest-environment jsdom */
/**
 * Regression test for the bug /code-review high found and this session
 * fixed: AiEcgSummary used to hardcode "reads normal sinus rhythm" for
 * EVERY 'ready' status, regardless of what the machine actually printed.
 * deriveEcgAiSummaryStatus's own NORMAL_RHYTHM_PATTERN classifies "Normal
 * ECG", "Normal electrocardiogram" and "Normal 12-lead ECG" as 'ready' too —
 * none of which mention "sinus rhythm" — so a patient whose cart printed one
 * of those saw a confident, false claim about their own document. This test
 * proves the component renders the ACTUAL `statement` prop, not a hardcoded
 * guess, in both the ready and flagged cases — and would have failed against
 * the pre-fix version (sabotage check below).
 */
import { render, screen } from "@testing-library/react";
import { AiEcgSummary } from "./ai-ecg-summary";

describe("AiEcgSummary", () => {
  it("renders nothing while status is 'unavailable'", () => {
    const { container } = render(<AiEcgSummary status="unavailable" statement={null} />);
    expect(container.textContent).toBe("");
  });

  it("shows a preparing message while status is 'pending'", () => {
    render(<AiEcgSummary status="pending" statement={null} />);
    expect(screen.getByText(/preparing an automatic summary/i)).not.toBeNull();
  });

  // The regression case: a genuinely 'ready' ECG whose machine statement
  // never mentions "sinus rhythm" at all. The old, buggy component would
  // have rendered "reads normal sinus rhythm" here regardless of `statement`
  // — this assertion specifically checks the ACTUAL printed text appears,
  // and that the old hardcoded phrase does not, unless it's genuinely part
  // of the real statement.
  it("shows the machine's ACTUAL printed statement when ready, never a hardcoded 'normal sinus rhythm' guess", () => {
    render(<AiEcgSummary status="ready" statement="Normal 12-lead ECG" />);
    expect(screen.getByText(/normal 12-lead ecg/i)).not.toBeNull();
    expect(screen.queryByText(/normal sinus rhythm/i)).toBeNull();
  });

  it("still correctly shows 'normal sinus rhythm' when that is genuinely what was printed", () => {
    render(<AiEcgSummary status="ready" statement="Normal sinus rhythm" />);
    expect(screen.getByText(/normal sinus rhythm/i)).not.toBeNull();
  });

  it("shows the machine's actual statement and a doctor prompt when flagged", () => {
    render(<AiEcgSummary status="flagged" statement="Sinus tachycardia" />);
    expect(screen.getByText(/sinus tachycardia/i)).not.toBeNull();
    expect(screen.getByText(/message your care team/i)).not.toBeNull();
  });

  it("does not show the 'message your care team' prompt when ready (not flagged)", () => {
    render(<AiEcgSummary status="ready" statement="Normal ECG" />);
    expect(screen.queryByText(/message your care team/i)).toBeNull();
  });
});
