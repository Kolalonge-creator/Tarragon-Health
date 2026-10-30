/** @jest-environment jsdom */
/**
 * S70a, 18.9: every reading says where it came from, in the same words on web and on the phone, and a wrist oxygen reading asks for a
 * fingertip recheck. The photo label is the one the spec names.
 */
import { render, screen } from "@testing-library/react";
import { CufflessCalibrationNote, SourceBadge, WristSpo2Note } from "./source-badge";

describe("SourceBadge", () => {
  it.each([
    ["manual", "Typed by you"],
    ["device", "From your device"],
    ["wearable", "Wearable estimate"],
    ["cgm", "From your glucose sensor"],
    ["photo_confirmed", "Photo, confirmed by you"],
    ["fhir_import", "Imported record"],
    [null, "Typed by you"],
    ["some_new_source", "Other source"],
  ])("labels %s as %s", (source, label) => {
    render(<SourceBadge source={source} />);
    expect(screen.getByTestId("source-badge").textContent).toBe(label);
  });
});

describe("SourceBadge: where it was taken (S07y)", () => {
  it("a pharmacy or clinic machine reading says so, instead of 'Typed by you'", () => {
    render(<SourceBadge source="manual" origin="pharmacy_machine" />);
    expect(screen.getByTestId("source-badge").textContent).toBe("Taken at a pharmacy or clinic machine");
  });
  it("a paper diary reading says so", () => {
    render(<SourceBadge source="manual" origin="paper_diary" />);
    expect(screen.getByTestId("source-badge").textContent).toBe("From your paper diary");
  });
  it("an unknown or missing label changes nothing", () => {
    render(<SourceBadge source="manual" origin={null} />);
    expect(screen.getByTestId("source-badge").textContent).toBe("Typed by you");
  });
});

describe("WristSpo2Note", () => {
  it("asks for a fingertip recheck on a wearable oxygen reading only", () => {
    const { container, rerender } = render(<WristSpo2Note source="wearable" vitalType="spo2" />);
    expect(container.textContent).toMatch(/fingertip pulse oximeter/);
    rerender(<WristSpo2Note source="device" vitalType="spo2" />);
    expect(container.textContent).toBe("");
    rerender(<WristSpo2Note source="wearable" vitalType="pulse" />);
    expect(container.textContent).toBe("");
  });
});

describe("CufflessCalibrationNote (S70b)", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  it("says estimate and when it was last checked against a cuff", () => {
    const { container } = render(<CufflessCalibrationNote source="wearable" vitalType="blood_pressure" lastCuffCheckAt={ago(3)} now={now} />);
    expect(container.textContent).toMatch(/Estimate\./);
    expect(container.textContent).toMatch(/Last checked against a cuff on/);
    expect(container.textContent).toMatch(/worth a cuff check this week/);
    expect(container.textContent).not.toMatch(/rough guide/);
  });
  it("goes stale after the proposed number of days", () => {
    const { container } = render(<CufflessCalibrationNote source="wearable" vitalType="blood_pressure" lastCuffCheckAt={ago(40)} now={now} />);
    expect(container.textContent).toMatch(/rough guide/);
  });
  it("says never checked when there is no cuff reading, and says nothing about a date when it could not be looked up", () => {
    const never = render(<CufflessCalibrationNote source="wearable" vitalType="blood_pressure" lastCuffCheckAt={null} now={now} />);
    expect(never.container.textContent).toMatch(/Not checked against a cuff yet/);
    never.unmount();
    const unknown = render(<CufflessCalibrationNote source="wearable" vitalType="blood_pressure" lastCuffCheckAt={undefined} now={now} />);
    expect(unknown.container.textContent).toMatch(/could not check when this was last compared/);
    expect(unknown.container.textContent).not.toMatch(/Last checked against a cuff on|Not checked against/);
  });
  it("a raised estimate keeps only the factual line: no rough-guide wording and no general cuff-check line", () => {
    const { container } = render(<CufflessCalibrationNote source="wearable" vitalType="blood_pressure" lastCuffCheckAt={ago(40)} level="red" now={now} />);
    expect(container.textContent).toMatch(/Last checked against a cuff on/);
    expect(container.textContent).not.toMatch(/rough guide|worth a cuff check/);
  });
  it("shows nothing for a cuff reading or another vital", () => {
    expect(render(<CufflessCalibrationNote source="manual" vitalType="blood_pressure" lastCuffCheckAt={null} />).container.textContent).toBe("");
    expect(render(<CufflessCalibrationNote source="wearable" vitalType="pulse" lastCuffCheckAt={null} />).container.textContent).toBe("");
  });
});
