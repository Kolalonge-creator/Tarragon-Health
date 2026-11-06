/** @jest-environment jsdom */
/**
 * P17: the vitals chart's text alternative lists exactly the plotted readings, newest first, with the chart's unit and where each came from. A reading with
 * no value for the chosen measure is left out, never shown as a zero or filled in.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { trendSourceLabel, trendTableRows, VitalsTrendTable } from "./vitals-trend-table";

const bp = [
  { taken_at: "2026-10-01T08:00:00Z", systolic: 132, diastolic: 84, source: "manual" },
  { taken_at: "2026-10-02T08:00:00Z", systolic: null, diastolic: 80, source: "manual" },
  { taken_at: "2026-10-03T08:00:00Z", systolic: 141, diastolic: 90, source: "device", entry_origin: null },
];

describe("trendTableRows", () => {
  it("lists blood pressure as systolic/diastolic, newest first, skipping a half reading", () => {
    const rows = trendTableRows("blood_pressure", bp, "mmHg");
    expect(rows.map((r) => r.value)).toEqual(["141/90", "132/84"]);
    expect(rows.every((r) => r.unit === "mmHg")).toBe(true);
  });

  it("uses the plotted display value for single-number measures and never invents one", () => {
    const pts = [
      { taken_at: "2026-10-01T08:00:00Z", glucose_display: 6.1, source: "manual" },
      { taken_at: "2026-10-02T08:00:00Z", glucose_display: null, source: "manual" },
    ];
    expect(trendTableRows("glucose", pts, "mmol/L")).toEqual([
      expect.objectContaining({ takenAt: "2026-10-01T08:00:00Z", value: "6.1", unit: "mmol/L" }),
    ]);
    expect(trendTableRows("weight", [], "kg")).toEqual([]);
  });

  it("says where each reading came from", () => {
    expect(trendSourceLabel({ taken_at: "x", source: "wearable" }, "pulse")).toBe("Wearable estimate");
    expect(trendSourceLabel({ taken_at: "x", source: "manual", entry_origin: "pharmacy_machine" }, "blood_pressure")).toBe(
      "Taken at a pharmacy or clinic machine",
    );
    expect(trendSourceLabel({ taken_at: "x", source: "manual", assisted: true }, "weight")).toMatch(/entered by a helper$/);
    expect(trendSourceLabel({ taken_at: "x", value: 6.2 }, "hba1c")).toBe("Lab result");
  });
});

/** Opens the native <details> the way a click on its summary does. */
function openTable(container: HTMLElement) {
  const details = container.querySelector("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

describe("VitalsTrendTable", () => {
  it("renders no rows while folded, then a table with a caption and one row per reading once opened", () => {
    const { container } = render(<VitalsTrendTable caption="Blood pressure readings, 90 days" rows={trendTableRows("blood_pressure", bp, "mmHg")} />);
    expect(screen.getByText("Show as a table")).toBeTruthy();
    expect(screen.queryByTestId("vitals-trend-table")).toBeNull();
    openTable(container);
    const table = screen.getByTestId("vitals-trend-table");
    expect(within(table).getByText("Blood pressure readings, 90 days")).toBeTruthy();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Date", "Value", "Unit", "Source"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("stays mounted and open while a new range loads, then shows the new rows", () => {
    const rows = trendTableRows("blood_pressure", bp, "mmHg");
    const { container, rerender } = render(<VitalsTrendTable caption="x" rows={rows} />);
    openTable(container);
    rerender(<VitalsTrendTable caption="x" rows={[]} loading />);
    expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText("Loading readings")).toBeTruthy();
    rerender(<VitalsTrendTable caption="x" rows={rows.slice(0, 1)} />);
    expect(within(screen.getByTestId("vitals-trend-table")).getAllByRole("row")).toHaveLength(2);
  });

  it("renders nothing with no readings", () => {
    const { container } = render(<VitalsTrendTable caption="x" rows={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
