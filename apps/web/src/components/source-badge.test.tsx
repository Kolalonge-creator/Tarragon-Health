/** @jest-environment jsdom */
/**
 * S70a, 18.9: every reading says where it came from, in the same words on web and on the phone, and a wrist oxygen reading asks for a
 * fingertip recheck. The photo label is the one the spec names.
 */
import { render, screen } from "@testing-library/react";
import { SourceBadge, WristSpo2Note } from "./source-badge";

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
