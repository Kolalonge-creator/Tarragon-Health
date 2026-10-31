/** @jest-environment jsdom */
import { render } from "@testing-library/react";
import { AtAGlancePanel } from "./lifestyle-client";

jest.mock("@/lib/queries/weight-goal", () => ({ useWeightGoal: () => ({ data: null }) }));
jest.mock("@/lib/queries/vitals", () => ({ useLatestWeightKg: () => ({ data: null }) }));
jest.mock("@/lib/queries/activity", () => ({
  useActivityGoal: () => ({ data: null }),
  useTodaySteps: () => ({ data: 0 }),
}));
jest.mock("@/lib/queries/wellness", () => ({ useWellnessPointsBalance: () => ({ data: null }) }));
jest.mock("@/app/(dashboard)/patient/ai-coach-chat", () => ({ AiCoachChat: () => null }));
jest.mock("./actions", () => ({}));
jest.mock("./goals-dialog", () => ({ GoalsDialog: () => null }));
jest.mock("./condition-enrollment-card", () => ({ ConditionEnrollmentCard: () => null }));
jest.mock("@/components/ai/assistant-emergency-button", () => ({ AssistantEmergencyButton: () => null }));

const hrefs = (root: ParentNode) =>
  Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("AtAGlancePanel", () => {
  it("shows three trackers up front and folds the rest, losing none", () => {
    const { container } = render(<AtAGlancePanel patientId="p1" />);
    const fold = container.querySelector("details") as HTMLDetailsElement;
    expect(fold).not.toBeNull();
    expect(fold.open).toBe(false);

    const up = hrefs(container).filter((h) => !hrefs(fold).includes(h));
    expect(up).toEqual(["/patient/nutrition", "/patient/weight", "/patient/activity"]);
    expect(hrefs(fold)).toEqual([
      "/patient/exercise",
      "/patient/sleep",
      "/patient/smoking",
      "/patient/alcohol",
      "/patient/wellness",
    ]);
  });
});
