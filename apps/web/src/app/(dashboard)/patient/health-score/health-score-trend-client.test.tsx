/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { HealthScoreTrendClient, chartDateLabel } from "./health-score-trend-client";

const latest = jest.fn();
const history = jest.fn();
jest.mock("@/lib/queries/health-score", () => ({
  useLatestHealthScore: () => latest(),
  useHealthScoreHistory: () => history(),
}));
jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

const ok = (data: unknown) => ({ data, isLoading: false, isError: false });

describe("Health Score page hero", () => {
  it("shows the score as the first big number with its status word", () => {
    latest.mockReturnValue(ok({ score: 72, risk_level: "moderate", computed_at: "2026-10-01T00:00:00Z", inputs: { components: [] } }));
    history.mockReturnValue(ok([]));
    render(<HealthScoreTrendClient patientId="p1" />);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("Room to improve")).toBeTruthy();
  });

  it("explains what feeds the score instead of a fake number when there is none", () => {
    latest.mockReturnValue(ok(null));
    history.mockReturnValue(ok([]));
    render(<HealthScoreTrendClient patientId="p1" />);
    expect(screen.getByText(/appears after your next blood pressure or weight reading/i)).toBeTruthy();
  });

  it("a failed read never looks like an empty score", () => {
    latest.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    history.mockReturnValue(ok([]));
    render(<HealthScoreTrendClient patientId="p1" />);
    expect(screen.getByText(/couldn.t load your Health Score/i)).toBeTruthy();
    expect(screen.queryByText(/appears after your next/i)).toBeNull();
  });

  it("says the trend sentence once, not in the hero and again under Over time", () => {
    latest.mockReturnValue(ok({ score: 33, risk_level: "high", computed_at: "2026-09-16T00:00:00Z", inputs: { components: [] } }));
    history.mockReturnValue(ok([
      { score: 100, inputs: { components: [] }, computed_at: "2026-09-01T00:00:00Z" },
      { score: 33, inputs: { components: [] }, computed_at: "2026-09-16T00:00:00Z" },
    ]));
    render(<HealthScoreTrendClient patientId="p1" />);
    expect(screen.getAllByText(/has moved from 100 to 33/)).toHaveLength(1);
  });

  it("labels points by day so two scores in one month are distinguishable", () => {
    expect(chartDateLabel("2026-09-01T10:00:00Z")).not.toBe(chartDateLabel("2026-09-16T10:00:00Z"));
  });
});
