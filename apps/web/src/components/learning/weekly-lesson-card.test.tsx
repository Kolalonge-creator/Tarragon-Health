/** @jest-environment jsdom */
/**
 * This week's lesson card (S55 follow-up, weekly pacing): says "this week", offers a start button for an open lesson, shows the done
 * message once the server says it was finished this week, and for a members-only creator lesson shows the title and a calm
 * Membership note with no start button and none of the lesson text.
 */
import { render, screen } from "@testing-library/react";
import { WeeklyLessonCard } from "./weekly-lesson-card";

type Lesson = Record<string, unknown> | null;
let lesson: Lesson = null;
jest.mock("@/lib/queries/learning-centre", () => ({
  weeklyLessonKey: (id: string) => ["learning-weekly-lesson", id],
  useWeeklyMicroLesson: () => ({ data: lesson, isLoading: false }),
  useHealthEducationItemTrust: () => ({ data: null }),
  useSaveLessonForConsultation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/lib/queries/health-education", () => ({ useMarkContentProgress: () => ({ mutateAsync: jest.fn(), isPending: false, isError: false }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

const OPEN = {
  content_id: "c1", code: "wk-1", title: "Salt and your pressure", body: "SECRET BODY", estimated_minutes: 4, lesson_action: "Check one label",
  check_question: null, completed_this_week: false, members_only: false, creator_name: null,
};

describe("WeeklyLessonCard", () => {
  it("renders nothing when there is no lesson this week", () => {
    lesson = null;
    const { container } = render(<WeeklyLessonCard patientId="p" organisationId="o" />);
    expect(container.textContent).toBe("");
  });

  it("is this week's lesson, with minutes and a start button", () => {
    lesson = OPEN;
    render(<WeeklyLessonCard patientId="p" organisationId="o" />);
    expect(screen.getByText("This week's lesson")).toBeTruthy();
    expect(screen.getByText("About 4 min")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start this week's lesson" })).toBeTruthy();
    expect(screen.queryByText(/tomorrow|today/i)).toBeNull();
  });

  it("says done for this week, and that the next one comes next week", () => {
    lesson = { ...OPEN, completed_this_week: true };
    render(<WeeklyLessonCard patientId="p" organisationId="o" />);
    expect(screen.getByText(/Done for this week/)).toBeTruthy();
    expect(screen.getByText(/next week/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
  });

  it("for a members-only lesson shows title, credit and the Membership note, no start button, no lesson text", () => {
    lesson = { ...OPEN, body: "", lesson_action: null, members_only: true, creator_name: "Dr Creator" };
    render(<WeeklyLessonCard patientId="p" organisationId="o" />);
    expect(screen.getByText("Salt and your pressure")).toBeTruthy();
    expect(screen.getByTestId("members-only-prompt").textContent).toContain("Part of Membership");
    expect(screen.getByTestId("members-only-prompt").textContent).toContain("By Dr Creator");
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
    expect(document.body.textContent).not.toContain("SECRET BODY");
  });
});
