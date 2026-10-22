/** @jest-environment jsdom */
/**
 * Learning quality gates and record-triggered lessons, web components:
 *  - the portion guide takes every amount from the versioned configuration (change the config and the screen changes), says plainly when the
 *    amounts are still placeholders, and draws hand outlines that screen readers skip;
 *  - tap-to-define marks only the terms the server handed over, and a lesson with no terms is plain text;
 *  - the teach-back shows the right answer and the author's kind explanation after a wrong answer, never a streak or loss wording, and renders
 *    nothing when a lesson has no questions;
 *  - the record-triggered lesson card renders nothing while the guard is off, shows the urgent-help box and NO lesson when urgent, and a lesson
 *    only when the state says so.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { portionPhrase } from "@tarragon/i18n";
import { PortionGuideView } from "./portion-guide-view";
import { GlossaryText } from "./glossary-text";
import { TeachbackQuiz } from "./teachback-quiz";
import { RecordLessonCard } from "./record-lesson-card";

let glossary: { term: string; definition: string; aliases: string[] }[] = [];
let teachback: { question: string; options: string[] }[] | null = null;
let recordState: Record<string, unknown> | undefined;
const recordMutate = jest.fn();
const shareMutate = jest.fn();

jest.mock("@/lib/queries/learning-quality", () => ({
  useLearningGlossary: () => ({ data: glossary }),
  useLessonTeachback: () => ({ data: teachback }),
  useRecordTeachback: () => ({ mutateAsync: recordMutate, isPending: false, isError: false }),
  useShareTeachback: () => ({ mutateAsync: shareMutate, isPending: false, isError: false }),
  useRecordLesson: () => ({ data: recordState }),
}));
jest.mock("@/lib/queries/learning-centre", () => ({
  useHealthEducationItemTrust: () => ({ data: null }),
  useSaveLessonForConsultation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const BODY = [
  "Use your own hand.",
  "",
  "[portion swallow fist] Pounded yam, eba",
  "Eat it with soup.",
  "",
  "[portion drinks cupped_hand] Soft drinks",
  "",
  "A closing note.",
].join("\n");
const CFG = { portions: { swallow: { diabetes: { amount: 2, unit: "fist", per: "meal" as const } }, drinks: { diabetes: { amount: 0, unit: "cupped_hand", per: "day" as const } } } };

describe("PortionGuideView", () => {
  it("takes every amount from the configuration", () => {
    const { rerender } = render(<PortionGuideView body={BODY} audience="diabetes" config={CFG} confirmed />);
    expect(screen.getByText("About 2 fists each meal")).toBeTruthy();
    expect(screen.getByText("Best to leave this out each day")).toBeTruthy();
    rerender(<PortionGuideView body={BODY} audience="diabetes" config={{ portions: { ...CFG.portions, swallow: { diabetes: { amount: 1, unit: "fist", per: "week" } } } }} confirmed />);
    expect(screen.getByText("About 1 fist each week")).toBeTruthy();
  });
  it("shows no amount for an audience the config has none for, and still shows the food and its tip", () => {
    render(<PortionGuideView body={BODY} audience="blood_pressure" config={CFG} confirmed />);
    expect(screen.getByText("Pounded yam, eba")).toBeTruthy();
    expect(screen.getByText("Eat it with soup.")).toBeTruthy();
    expect(screen.queryByText(/About/)).toBeNull();
  });
  it("says plainly that the amounts are placeholders until confirmed, and not once confirmed", () => {
    const { rerender } = render(<PortionGuideView body={BODY} audience="diabetes" config={CFG} confirmed={false} />);
    expect(screen.getByTestId("portion-draft-note").textContent).toContain("placeholders");
    rerender(<PortionGuideView body={BODY} audience="diabetes" config={CFG} confirmed />);
    expect(screen.queryByTestId("portion-draft-note")).toBeNull();
  });
  it("draws hand outlines that are hidden from screen readers and holds the intro, legend and notes as text", () => {
    const { container } = render(<PortionGuideView body={BODY} audience="diabetes" config={CFG} confirmed />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(2);
    svgs.forEach((s) => expect(s.getAttribute("aria-hidden")).toBe("true"));
    expect(screen.getByText("Use your own hand.")).toBeTruthy();
    expect(screen.getByText(/A palm is the flat of your hand/)).toBeTruthy();
    expect(screen.getByText("A closing note.")).toBeTruthy();
  });
  it("uses the bundled PROPOSED configuration by default, still marked as placeholders", () => {
    render(<PortionGuideView body={BODY} audience="diabetes" />);
    expect(screen.getByTestId("portion-draft-note")).toBeTruthy();
    expect(screen.getByText("About 1 fist each meal")).toBeTruthy();
  });
  it("phrases singular, plural, zero and each unit of time", () => {
    expect(portionPhrase({ amount: 1, unit: "cube", per: "pot" })).toBe("About 1 seasoning cube for each pot");
    expect(portionPhrase({ amount: 2, unit: "slice", per: "meal" })).toBe("About 2 slices each meal");
    expect(portionPhrase({ amount: 0, unit: "fist", per: "week" })).toBe("Best to leave this out each week");
  });
});

describe("GlossaryText", () => {
  it("renders plain text when the server handed over no reviewed terms", () => {
    glossary = [];
    const { container } = render(<GlossaryText text="Your systolic number is the top one." />);
    expect(container.textContent).toBe("Your systolic number is the top one.");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("underlines a reviewed term and shows its definition on tap, then closes", () => {
    glossary = [{ term: "systolic", definition: "The top number of a reading.", aliases: [] }];
    render(<GlossaryText text="Your systolic number is the top one." />);
    const word = screen.getByRole("button", { name: "systolic" });
    expect(word.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(word);
    expect(screen.getByTestId("glossary-definition").textContent).toContain("The top number of a reading.");
    expect(word.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("glossary-definition")).toBeNull();
  });
  it("a term that is not in the list is never underlined", () => {
    glossary = [{ term: "systolic", definition: "The top number of a reading.", aliases: [] }];
    render(<GlossaryText text="Hypertension is high pressure." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TeachbackQuiz", () => {
  beforeEach(() => {
    teachback = [{ question: "Which number is on top?", options: ["Systolic", "Diastolic"] }];
    recordMutate.mockReset();
    shareMutate.mockReset();
  });
  it("renders nothing when the lesson has no teach-back", () => {
    teachback = null;
    const { container } = render(<TeachbackQuiz code="x" />);
    expect(container.textContent).toBe("");
  });
  it("says it is private and optional, and offers no streak, score board or loss wording", () => {
    render(<TeachbackQuiz code="x" />);
    const text = screen.getByTestId("teachback").textContent ?? "";
    expect(text).toContain("only for you");
    expect(text).toContain("does not change whether you have finished the lesson");
    expect(text).not.toMatch(/streak|lose|lost|fail|leaderboard|rank/i);
  });
  it("after a wrong answer shows the right one and the kind explanation, and the result in positive words", async () => {
    recordMutate.mockResolvedValue({ total: 1, correct: 0, marks: [{ correct: false, correct_index: 0, explanation: "The top number is the systolic one." }] });
    render(<TeachbackQuiz code="x" />);
    fireEvent.click(screen.getByLabelText("Diastolic"));
    fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
    await waitFor(() => expect(screen.getByText("The top number is the systolic one.")).toBeTruthy());
    expect(screen.getByText("Not quite yet. The answer is: Systolic")).toBeTruthy();
    expect(screen.getByText("You got 0 of 1 right.")).toBeTruthy();
    expect(recordMutate).toHaveBeenCalledWith([1]);
  });
  it("sharing with the care team is a separate, explicit press that can be undone", async () => {
    recordMutate.mockResolvedValue({ total: 1, correct: 1, marks: [{ correct: true, correct_index: 0, explanation: "Yes." }] });
    shareMutate.mockResolvedValue(true);
    render(<TeachbackQuiz code="x" />);
    fireEvent.click(screen.getByLabelText("Systolic"));
    fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Share my answers with my care team" })).toBeTruthy());
    expect(shareMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Not shared.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share my answers with my care team" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop sharing" })).toBeTruthy());
    expect(shareMutate).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(screen.getByText("Not shared.")).toBeTruthy());
    expect(shareMutate).toHaveBeenLastCalledWith(false);
  });
  it("try again clears the answers", async () => {
    recordMutate.mockResolvedValue({ total: 1, correct: 1, marks: [{ correct: true, correct_index: 0, explanation: "Yes." }] });
    render(<TeachbackQuiz code="x" />);
    fireEvent.click(screen.getByLabelText("Systolic"));
    fireEvent.click(screen.getByRole("button", { name: "Check my answers" }));
    await waitFor(() => screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Check my answers" })).toBeTruthy();
    expect((screen.getByLabelText("Systolic") as HTMLInputElement).checked).toBe(false);
  });
});

describe("RecordLessonCard", () => {
  it("renders nothing while the guard is off, while loading, or when there is nothing to show", () => {
    for (const s of [undefined, { kind: "off" }, { kind: "none" }]) {
      recordState = s;
      const { container, unmount } = render(<RecordLessonCard patientId="p" />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
  it("when urgent shows the urgent-help box and no lesson", () => {
    recordState = { kind: "urgent" };
    render(<RecordLessonCard patientId="p" />);
    expect(screen.getByTestId("record-lesson-urgent")).toBeTruthy();
    expect(screen.getByTestId("urgent-help-box")).toBeTruthy();
    expect(screen.queryByTestId("record-lesson-card")).toBeNull();
    expect(screen.queryByRole("button", { name: /Read the short lesson/ })).toBeNull();
  });
  it("shows the lesson title, keeps the body until asked, and carries the fixed urgent-help box with it", () => {
    glossary = [];
    recordState = { kind: "lesson", code: "record-bp-in-target", title: "Your blood pressure reading is in a good range", body: "LESSON BODY TEXT" };
    render(<RecordLessonCard patientId="p" />);
    expect(screen.getByText("What this reading means")).toBeTruthy();
    expect(screen.getByText("Your blood pressure reading is in a good range")).toBeTruthy();
    expect(document.body.textContent).not.toContain("LESSON BODY TEXT");
    fireEvent.click(screen.getByRole("button", { name: "Read the short lesson" }));
    expect(screen.getByText("LESSON BODY TEXT")).toBeTruthy();
    expect(screen.getByTestId("urgent-help-box")).toBeTruthy();
  });
});
