/** @jest-environment jsdom */
/**
 * MSK pain programme screens (S96): the day's exercises with a drawing and text steps, the difficulty rating, the lighter plan, rest from the
 * activity gate, and the "my pain got worse" flow (a positive pauses and says so, a clear check records a step-down). No accessibility violations.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import "@/test/a11y"; // registers toHaveNoViolations
import { mskExerciseRow, type MskStartExtras } from "@tarragon/shared";

const rpc = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { MskDaySet } from "./msk-day-set";
import { MskFlareUp } from "./msk-flare-up";

const extras = (over: Partial<MskStartExtras> = {}): MskStartExtras => ({
  exercises: [mskExerciseRow("walk"), mskExerciseRow("bird_dog"), mskExerciseRow("bridge")],
  gate: { decision: "allow", maxIntensity: "vigorous" },
  stepDown: null,
  daysDone: 0,
  daysNeeded: 3,
  ...over,
});

beforeEach(() => rpc.mockReset());

describe("MskDaySet", () => {
  it("shows each exercise with a drawing, steps, dose, easier, harder and stop rule, and has no accessibility violations", async () => {
    const { container } = render(<MskDaySet enrolmentId="e1" ordinal={1} extras={extras()} />);
    expect(screen.getByText("Easy walk")).toBeTruthy();
    expect(screen.getByTestId("msk-drawing-walk").getAttribute("aria-label")).toMatch(/walking/i);
    expect(screen.getAllByText(/^Stop if:/).length).toBe(3);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a gentle-only gate hides the moderate exercise", () => {
    render(<MskDaySet enrolmentId="e1" ordinal={1} extras={extras({ gate: { decision: "restrict", maxIntensity: "gentle" } })} />);
    expect(screen.queryByText("Arm and leg reach")).toBeNull();
    expect(screen.getByText(/gentle exercises only/i)).toBeTruthy();
  });

  it("a rest answer shows no exercise and says it is a rest day", () => {
    render(<MskDaySet enrolmentId="e1" ordinal={1} extras={extras({ gate: { decision: "rest", maxIntensity: "none" } })} />);
    expect(screen.queryByText("Easy walk")).toBeNull();
    expect(screen.getByText(/rest day/i)).toBeTruthy();
  });

  it("a running step-down shows fewer, gentler exercises and its end date", () => {
    const until = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(Date.now() + 86_400_000));
    render(<MskDaySet enrolmentId="e1" ordinal={1} extras={extras({ stepDown: { until } })} />);
    expect(screen.queryByText("Arm and leg reach")).toBeNull();
    expect(screen.getByText(new RegExp(`lighter plan until ${until}`, "i"))).toBeTruthy();
  });

  it("sends a rating to the database and offers the easier version when told to", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", offer_easier: true, days_done: 1 }, error: null });
    render(<MskDaySet enrolmentId="e1" ordinal={2} extras={extras()} />);
    await act(async () => { fireEvent.click(screen.getAllByText("Too hard")[0] as HTMLElement); });
    expect(rpc).toHaveBeenCalledWith("record_msk_exercise_rating", { p_enrolment: "e1", p_ordinal: 2, p_exercise_key: "walk", p_rating: 5 });
    await waitFor(() => expect(screen.getByText(/too hard twice/i)).toBeTruthy());
    expect(screen.getByText(/1 of 3/)).toBeTruthy();
  });

  it("says plainly when a rating could not be saved", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    render(<MskDaySet enrolmentId="e1" ordinal={1} extras={extras()} />);
    await act(async () => { fireEvent.click(screen.getAllByText("Easy")[0] as HTMLElement); });
    expect(await screen.findByText(/could not save/i)).toBeTruthy();
  });
});

describe("MskFlareUp", () => {
  const questions = {
    programme: { code: "pain_back", title: "Back", summary: "", status: "draft" },
    open: true,
    questions: [
      { code: "saddle_numbness", question: "Saddle numbness?", kind: "yes_no" },
      { code: "fever", question: "Fever?", kind: "yes_no" },
    ],
  };

  async function openAndAnswer(yes: string[]) {
    rpc.mockImplementation((name: string) => (name === "get_therapy_entry_questions" ? Promise.resolve({ data: questions, error: null }) : Promise.resolve({ data: null, error: null })));
    render(<MskFlareUp enrolmentId="e1" programmeCode="pain_back" />);
    await act(async () => { fireEvent.click(screen.getByText("My pain got worse")); });
    await screen.findByText("Saddle numbness?");
    for (const q of questions.questions) {
      const radios = document.getElementsByName(`q-${q.code}`);
      fireEvent.click(radios[yes.includes(q.code) ? 0 : 1] as HTMLElement);
    }
  }

  it("asks the red-flag questions again before anything else and has no accessibility violations", async () => {
    await openAndAnswer([]);
    expect(rpc).toHaveBeenCalledWith("get_therapy_entry_questions", { p_programme_code: "pain_back" });
    expect(rpc).not.toHaveBeenCalledWith("report_msk_flare_up", expect.anything());
    expect(await axe(document.body.firstElementChild as HTMLElement)).toHaveNoViolations();
  });

  it("a positive re-check pauses the plan and shows urgent guidance, never a continue message", async () => {
    await openAndAnswer(["saddle_numbness"]);
    rpc.mockImplementation(() => Promise.resolve({ data: { status: "stopped", route: "same_day_clinician", task_failed: false }, error: null }));
    await act(async () => { fireEvent.click(screen.getByText("Check and carry on")); });
    expect(await screen.findByText(/paused while your care team looks/i)).toBeTruthy();
    expect(screen.queryByText(/lighter plan/i)).toBeNull();
    expect(rpc).toHaveBeenCalledWith("report_msk_flare_up", { p_enrolment: "e1", p_recheck: { saddle_numbness: true, fever: false }, p_pain_now: undefined });
  });

  it("a clear re-check offers the lighter plan with its end date", async () => {
    await openAndAnswer([]);
    rpc.mockImplementation(() => Promise.resolve({ data: { status: "step_down", until: "2026-10-30" }, error: null }));
    await act(async () => { fireEvent.click(screen.getByText("Check and carry on")); });
    expect((await screen.findAllByText(/lighter plan/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/lighter plan until 2026-10-30/i)).toBeTruthy();
  });

  it("an answer it cannot read is an error message, never a continue", async () => {
    await openAndAnswer([]);
    rpc.mockImplementation(() => Promise.resolve({ data: { status: "???" }, error: null }));
    await act(async () => { fireEvent.click(screen.getByText("Check and carry on")); });
    expect(await screen.findByText(/could not check that/i)).toBeTruthy();
  });
});
