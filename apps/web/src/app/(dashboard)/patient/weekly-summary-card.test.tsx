import { renderToStaticMarkup } from "react-dom/server";
import { buildWeeklySummary, type WeeklyReading } from "@/lib/visit-report/weekly";

jest.mock("@/lib/queries/weekly-summary", () => ({ useWeeklySummary: jest.fn() }));
jest.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: unknown }) => children,
  CardHeader: ({ children }: { children: unknown }) => children,
  CardTitle: ({ children }: { children: unknown }) => children,
  CardContent: ({ children }: { children: unknown }) => children,
}));

import { WeeklySummaryBody } from "./weekly-summary-card";

const NOW = new Date("2026-10-07T12:00:00Z");
const bp = (sys: number, dia: number, at: string): WeeklyReading => ({
  vital_type: "blood_pressure",
  taken_at: at,
  systolic: sys,
  diastolic: dia,
  pulse_bpm: null,
  glucose_mmol_l: null,
  glucose_context: null,
  weight_kg: null,
  validation_status: "valid",
  source: "manual",
});

describe("WeeklySummaryBody", () => {
  it("shows a calm empty state with no guilt", () => {
    const html = renderToStaticMarkup(<WeeklySummaryBody data={buildWeeklySummary([], NOW)} />);
    expect(html).toContain("No readings in the last 7 days");
    expect(html.toLowerCase()).not.toMatch(/missed|failed|behind|streak/);
  });

  it("describes the change without a verdict", () => {
    const data = buildWeeklySummary(
      [bp(140, 90, "2026-10-06T08:00:00Z"), bp(130, 84, "2026-09-30T08:00:00Z")],
      NOW,
    );
    const html = renderToStaticMarkup(<WeeklySummaryBody data={data} />);
    expect(html).toContain("1 of the last 7 days");
    expect(html).toContain("10 higher than the week before");
    expect(html.toLowerCase()).not.toMatch(/good|bad|worse|better|controlled|normal|high blood/);
    expect(html).not.toContain("—");
  });
});
