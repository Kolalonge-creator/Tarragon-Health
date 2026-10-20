/** @jest-environment jsdom */
/**
 * S47a 4.7: the "Changed" marker says in words that a number was changed, and the edit control is offered only where the database would accept
 * the correction (a number the person typed herself, not blood pressure, not anything the care team recorded or reviewed).
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Tables } from "@tarragon/shared";
import { canOfferEdit, ChangedMarker, EditReading } from "./reading-edit";

jest.mock("./observation-actions", () => ({ correctOwnReading: jest.fn() }));
jest.mock("@/components/glucose-unit-provider", () => ({ useGlucoseUnit: () => "mg_dl" }));

type R = Tables<"vitals_readings">;
const base = { id: "r1", patient_id: "p1", source: "manual", validated_by: null, logged_by_profile_id: null, supersedes_id: null, vital_type: "weight" } as unknown as R;

describe("canOfferEdit", () => {
  it("is offered for a number the person typed herself", () => {
    expect(canOfferEdit(base)).toBe(true);
    expect(canOfferEdit({ ...base, vital_type: "water_ml" } as R)).toBe(true);
    expect(canOfferEdit({ ...base, vital_type: "glucose", logged_by_profile_id: "p1" } as R)).toBe(true);
  });
  it("is not offered for blood pressure, a device value, a reviewed reading, or one the care team recorded", () => {
    expect(canOfferEdit({ ...base, vital_type: "blood_pressure" } as R)).toBe(false);
    expect(canOfferEdit({ ...base, source: "device" } as R)).toBe(false);
    expect(canOfferEdit({ ...base, validated_by: "doc-1" } as R)).toBe(false);
    expect(canOfferEdit({ ...base, logged_by_profile_id: "staff-1" } as R)).toBe(false);
    expect(canOfferEdit({ ...base, vital_type: "ketones" } as R)).toBe(false);
  });
});

describe("ChangedMarker", () => {
  it("shows the word Changed (not colour alone) when the row supersedes another", () => {
    render(<ChangedMarker reading={{ supersedes_id: "old-1" }} />);
    expect(screen.getByText("Changed")).toBeTruthy();
    expect(screen.getByLabelText(/You changed this entry/)).toBeTruthy();
  });
  it("does not say 'you changed' when someone else made the change", () => {
    render(<ChangedMarker reading={{ supersedes_id: "old-1", patient_id: "p1", logged_by_profile_id: "staff-1" }} />);
    expect(screen.getByLabelText(/changed by someone else/)).toBeTruthy();
    expect(screen.queryByLabelText(/You changed this entry/)).toBeNull();
  });
  it("shows nothing for an untouched reading", () => {
    const { container } = render(<ChangedMarker reading={{ supersedes_id: null }} />);
    expect(container.textContent).toBe("");
  });
});

describe("EditReading", () => {
  const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
  it("offers the control with the unit the person reads for glucose", () => {
    wrap(<EditReading reading={{ ...base, vital_type: "glucose" } as R} />);
    expect(screen.getByText("Change this number")).toBeTruthy();
    expect(screen.getByLabelText(/The right number \(mg\/dL\)/)).toBeTruthy();
  });
  it("renders nothing for blood pressure", () => {
    const { container } = wrap(<EditReading reading={{ ...base, vital_type: "blood_pressure" } as R} />);
    expect(container.textContent).toBe("");
  });
});
