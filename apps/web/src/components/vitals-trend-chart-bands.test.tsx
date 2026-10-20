/** @jest-environment jsdom */
/**
 * S47a 4.6: the glucose and weight trend charts carry a target band, shaded AND named in a caption (colour is never the only signal).
 * recharts is stubbed to plain elements: the thing under test is which band is passed and what the words say, not SVG layout.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { VitalsTrendChart } from "./vitals-trend-chart";

jest.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    CartesianGrid: () => null,
    Line: () => null,
    LineChart: Pass,
    XAxis: () => null,
    YAxis: () => null,
    ReferenceArea: (props: { y1: number; y2: number }) => <div data-testid="reference-area" data-y1={props.y1} data-y2={props.y2} />,
  };
});
jest.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));
jest.mock("@/components/glucose-unit-provider", () => ({ useGlucoseUnit: () => "mmol_l" }));
jest.mock("@/components/height-discrepancy-banner", () => ({ HeightDiscrepancyBanner: () => null }));

const mockHeight = jest.fn();
const mockEligible = jest.fn();
jest.mock("@/lib/queries/vitals", () => ({
  useVitalsTrend: (_p: string, type: string) => ({
    data:
      type === "glucose"
        ? [
            { taken_at: "2026-10-01T08:00:00Z", glucose_mmol_l: 6.1 },
            { taken_at: "2026-10-02T08:00:00Z", glucose_mmol_l: 12.2 },
          ]
        : type === "weight"
          ? [
              { taken_at: "2026-10-01T08:00:00Z", weight_kg: 80 },
              { taken_at: "2026-10-02T08:00:00Z", weight_kg: 79 },
            ]
          : [],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useHba1cTrend: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useBmiTrend: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useHeightStatus: () => mockHeight(),
  useTrendBandsEligible: () => mockEligible(),
}));

describe("VitalsTrendChart target bands", () => {
  beforeEach(() => mockEligible.mockReturnValue({ data: true }));

  it("shades the glucose band 3.9 to 10 and names it in words", () => {
    mockHeight.mockReturnValue({ isLoading: false, data: { heightCm: 170 } });
    render(<VitalsTrendChart patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Glucose" }));
    const area = screen.getByTestId("reference-area");
    expect(area.getAttribute("data-y1")).toBe("3.9");
    expect(area.getAttribute("data-y2")).toBe("10");
    const caption = screen.getByTestId("glucose-band-caption").textContent ?? "";
    expect(caption).toContain("3.9");
    expect(caption).toContain("the usual target range");
    expect(caption).toContain("not a diagnosis");
  });

  it("shades the weight band at the person's own height and names it", () => {
    mockHeight.mockReturnValue({ isLoading: false, data: { heightCm: 170 } });
    render(<VitalsTrendChart patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Weight" }));
    const area = screen.getByTestId("reference-area");
    expect(area.getAttribute("data-y1")).toBe("53.5");
    expect(area.getAttribute("data-y2")).toBe("72");
    expect(screen.getByTestId("weight-band-caption").textContent).toContain("between 53.5 and 72 kg");
  });

  it("draws no weight band without a height on file and says why, instead of guessing one", () => {
    mockHeight.mockReturnValue({ isLoading: false, data: { heightCm: null } });
    render(<VitalsTrendChart patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Weight" }));
    expect(screen.queryByTestId("reference-area")).toBeNull();
    expect(screen.getByTestId("weight-band-missing").textContent).toContain("Add your height");
  });

  it("draws no band and no caption when the person is not eligible (module off, child, pregnant or unknown)", () => {
    mockHeight.mockReturnValue({ isLoading: false, data: { heightCm: 170 } });
    for (const eligible of [{ data: false }, { data: undefined }]) {
      mockEligible.mockReturnValue(eligible);
      const { unmount } = render(<VitalsTrendChart patientId="p1" />);
      fireEvent.click(screen.getByRole("button", { name: "Glucose" }));
      expect(screen.queryByTestId("reference-area")).toBeNull();
      expect(screen.queryByTestId("glucose-band-caption")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Weight" }));
      expect(screen.queryByTestId("reference-area")).toBeNull();
      expect(screen.queryByTestId("weight-band-caption")).toBeNull();
      expect(screen.queryByTestId("weight-band-missing")).toBeNull();
      unmount();
    }
  });
});
