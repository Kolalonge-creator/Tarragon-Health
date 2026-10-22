/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { BiomarkerResultCard } from "./biomarker-result-card";
import type { TrendPoint } from "@/lib/biomarkers/trend";

const point: TrendPoint = {
  takenAt: "2026-10-01T09:00:00Z",
  value: 5.02,
  unit: "mmol/L",
  refLow: null,
  refHigh: 5.0,
  refText: null,
  flag: "high",
  source: "lab_result",
  laboratory: "Synlab Nigeria",
};
const band = { unit: "mmol/L", good: { min: null, max: 5.0 }, acceptable: { min: null, max: 6.4 } };
const base = { code: "total_cholesterol", point, selected: false, href: "/patient/biomarkers?code=total_cholesterol", uiLanguage: "en" as const };

describe("BiomarkerResultCard", () => {
  it("with no grade shows only the laboratory's own flag and draws no bar", () => {
    render(<BiomarkerResultCard {...base} grade={null} band={null} />);
    expect(screen.getByText("Above range")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Acceptable")).toBeNull();
  });

  it("with a grade shows the Tarragon chip and a bar that says the same in words", () => {
    render(<BiomarkerResultCard {...base} grade="acceptable" band={band} />);
    expect(screen.getByText("Acceptable")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/acceptable range/i);
    expect(screen.getByText(/Synlab Nigeria/)).toBeTruthy();
  });
});
