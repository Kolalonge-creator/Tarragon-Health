/** @jest-environment jsdom */
/**
 * Accessibility coverage for the BP course on the web: the lesson list, and inside a lesson the words, the one action,
 * the teach-back question (a radio group) and the clarity question. Saving is mocked out (it is a Supabase upsert).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import "@/test/a11y"; // registers toHaveNoViolations

async function expectNoA11yViolations(container: HTMLElement) {
  expect(await axe(container)).toHaveNoViolations();
}
import { BpCourse } from "./bp-course";
import type { CourseLesson } from "./course-model";

jest.mock("@/lib/queries/health-education", () => ({
  useMarkContentProgress: () => ({ mutateAsync: jest.fn(async () => undefined), isPending: false }),
  useSubmitContentFeedback: () => ({ mutateAsync: jest.fn(async () => undefined) }),
}));

const lesson = (n: number, over: Partial<CourseLesson> = {}): CourseLesson => ({
  moduleNumber: n,
  contentId: `c${n}`,
  title: `Lesson title ${n}`,
  summary: "A short summary.",
  body: "First paragraph.\n\nSecond paragraph.",
  nextAction: "Do one small thing today.",
  estimatedMinutes: 3,
  check: { question: "What is true?", options: ["One", "Two", "Three"], answer_index: 1 },
  reviewedByName: null,
  nextReviewDue: null,
  status: null,
  ...over,
});

const ui = (lessons: CourseLesson[]) => <BpCourse lessons={lessons} locale="en" patientId="p" organisationId="o" />;

describe("BpCourse accessibility", () => {
  it("lists lessons with progress and no violations", async () => {
    const { container } = render(ui([lesson(1, { status: "understood" }), lesson(2)]));
    expect(screen.getByText("You have finished 1 of 2 lessons.")).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("opens a lesson with its words, action and question, without violations", async () => {
    const { container } = render(ui([lesson(1)]));
    fireEvent.click(screen.getByRole("button", { name: "Lesson 1" }));
    expect(screen.getByText("First paragraph.")).toBeTruthy();
    expect(screen.getByText("Do one small thing today.")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "What is true?" })).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it("answers the question kindly: a wrong answer says look again, never fail", () => {
    render(ui([lesson(1)]));
    fireEvent.click(screen.getByRole("button", { name: "Lesson 1" }));
    fireEvent.click(screen.getByRole("radio", { name: "One" }));
    fireEvent.click(screen.getByRole("button", { name: "Check my answer" }));
    return screen.findByText(/Read the lesson once more/).then((el) => expect(el.textContent).not.toMatch(/fail|wrong/i));
  });

  it("shows a reviewer credit only when there is a record", () => {
    const { rerender } = render(ui([lesson(1)]));
    fireEvent.click(screen.getByRole("button", { name: "Lesson 1" }));
    expect(screen.queryByText(/Reviewed by/)).toBeNull();
    rerender(ui([lesson(1, { reviewedByName: "Dr A" })]));
    expect(screen.getByText("Reviewed by Dr A")).toBeTruthy();
  });

  it("shows a calm message when no lesson is open", () => {
    render(ui([]));
    expect(screen.getByText(/not open yet/)).toBeTruthy();
  });
});
