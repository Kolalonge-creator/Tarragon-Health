/** @jest-environment jsdom */
/**
 * P17: the vitals chart offers the one shared range set (7 days to All), passes the chosen range to its bounded read, and carries a table alternative.
 * recharts is stubbed: the thing under test is the controls, the read's arguments and the words, not SVG layout.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { TREND_MAX_POINTS } from "@tarragon/shared";
import { VitalsTrendChart } from "./vitals-trend-chart";

const mockChartData = jest.fn();
jest.mock("recharts", () => {
  const LineChart = ({ children, data }: { children?: React.ReactNode; data?: unknown }) => {
    mockChartData(data);
    return <div>{children}</div>;
  };
  return { CartesianGrid: () => null, Line: () => null, LineChart, XAxis: () => null, YAxis: () => null, ReferenceArea: () => null };
});
jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));
jest.mock("@/components/glucose-unit-provider", () => ({ useGlucoseUnit: () => "mmol_l" }));
jest.mock("@/components/height-discrepancy-banner", () => ({ HeightDiscrepancyBanner: () => null }));

const mockTrend = jest.fn();
jest.mock("@/lib/queries/vitals", () => ({
  useVitalsTrend: (...args: unknown[]) => mockTrend(...args),
  useHba1cTrend: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useBmiTrend: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useHeightStatus: () => ({ data: { heightCm: null }, isLoading: false }),
  useTrendBandsEligible: () => ({ data: false }),
}));

const bpRows = [
  { taken_at: "2026-10-01T08:00:00Z", systolic: 132, diastolic: 84, source: "manual" },
  { taken_at: "2026-10-02T08:00:00Z", systolic: 128, diastolic: 82, source: "device" },
];

describe("VitalsTrendChart ranges and table", () => {
  beforeEach(() => mockTrend.mockReset().mockReturnValue({ data: bpRows, isLoading: false, isError: false, error: null }));

  it("dates a long range with the year, so two years never fold onto one label", () => {
    const lastDates = () => (mockChartData.mock.calls.at(-1)?.[0] as Array<{ date: string }>).map((p) => p.date);
    render(<VitalsTrendChart patientId="p1" />);
    expect(lastDates().every((d) => !/2026/.test(d))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(mockTrend).toHaveBeenLastCalledWith("p1", "blood_pressure", "all");
    expect(lastDates().every((d) => /2026/.test(d))).toBe(true);
  });

  it("offers the six shared ranges, starts on 90 days, and reads the chosen range", () => {
    render(<VitalsTrendChart patientId="p1" />);
    const group = screen.getByRole("group", { name: "Time range" });
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["7 days", "30 days", "90 days", "6 months", "12 months", "All"]);
    expect(mockTrend).toHaveBeenLastCalledWith("p1", "blood_pressure", "90d");
    fireEvent.click(screen.getByRole("button", { name: "12 months" }));
    expect(mockTrend).toHaveBeenLastCalledWith("p1", "blood_pressure", "12m");
    expect(screen.getByRole("button", { name: "12 months" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("lists the plotted readings in a table, newest first", () => {
    const { container } = render(<VitalsTrendChart patientId="p1" />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const table = screen.getByTestId("vitals-trend-table");
    const cells = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.querySelectorAll("td")[1].textContent);
    expect(cells).toEqual(["128/82", "132/84"]);
    expect(screen.queryByTestId("trend-point-cap")).toBeNull();
  });

  it("does not claim a cut when exactly the cap came back", () => {
    const exact = Array.from({ length: TREND_MAX_POINTS }, (_, i) => ({ taken_at: new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString(), systolic: 120, diastolic: 80, source: "manual" }));
    mockTrend.mockReturnValue({ data: exact, isLoading: false, isError: false, error: null });
    render(<VitalsTrendChart patientId="p1" />);
    expect(screen.queryByTestId("trend-point-cap")).toBeNull();
  });

  it("says so when the read came back past its cap, and plots only the newest cap-many", () => {
    const many = Array.from({ length: TREND_MAX_POINTS + 1 }, (_, i) => ({ taken_at: new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString(), systolic: 120, diastolic: 80, source: "manual" }));
    mockTrend.mockReturnValue({ data: many, isLoading: false, isError: false, error: null });
    render(<VitalsTrendChart patientId="p1" />);
    expect(screen.getByTestId("trend-point-cap").textContent).toContain("Older ones are not shown");
    expect(screen.getByText(`${TREND_MAX_POINTS} readings, newest first`)).toBeTruthy();
  });
});
