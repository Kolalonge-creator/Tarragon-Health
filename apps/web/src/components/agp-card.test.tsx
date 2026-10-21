/** @jest-environment jsdom */
/**
 * The glucose profile card for both audiences. The data hook is stubbed: what is under test is what each reader is shown and told, in words,
 * and that nothing here ever turns into advice about a dose.
 */
import { render, screen } from "@testing-library/react";
import { AgpCard } from "./agp-card";
import { FIXTURE_NOW, fortnight } from "@/lib/cgm/fixtures/agp-fortnight";

const mockReadings = jest.fn();
let mockUnit: "mg_dl" | "mmol_l" = "mmol_l";
jest.mock("@/lib/queries/cgm", () => ({ useAgpReadings: () => mockReadings() }));
jest.mock("@/components/glucose-unit-provider", () => ({ useGlucoseUnit: () => mockUnit }));

const ok = (samples: { takenAt: string; mmolL: number }[]) => ({ data: { samples, fetchedAt: FIXTURE_NOW }, isLoading: false, isError: false });

beforeEach(() => {
  mockUnit = "mmol_l";
  mockReadings.mockReset();
});

describe("AgpCard", () => {
  it("renders nothing while loading and when there are no sensor readings", () => {
    mockReadings.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    expect(render(<AgpCard patientId="p" audience="patient" />).container.innerHTML).toBe("");
    mockReadings.mockReturnValue(ok([]));
    expect(render(<AgpCard patientId="p" audience="clinician" />).container.innerHTML).toBe("");
  });

  it("says plainly that it is not available when the read fails, never that there are no readings", () => {
    mockReadings.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<AgpCard patientId="p" audience="clinician" />);
    expect(screen.getByRole("status").textContent).toContain("not available to you");
    expect(screen.queryByText(/no readings/i)).toBeNull();
  });

  it("shows the patient a three part range summary, the chart, plain pattern sentences and a way to message the care team", () => {
    mockReadings.mockReturnValue(ok(fortnight()));
    render(<AgpCard patientId="p" audience="patient" />);
    expect(screen.getByRole("img", { name: /glucose profile over a day/i })).toBeTruthy();
    expect(screen.getByText(/% in range/)).toBeTruthy();
    expect(screen.getByText(/Readings above 10\.0 mmol\/L showed up often/)).toBeTruthy();
    expect(screen.getByText(/Readings below 3\.9 mmol\/L showed up often/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /message your care team/i }).getAttribute("href")).toBe("/patient/messages");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the patient their own unit", () => {
    mockUnit = "mg_dl";
    mockReadings.mockReturnValue(ok(fortnight()));
    render(<AgpCard patientId="p" audience="patient" />);
    expect(screen.getByText(/Readings above 180 mg\/dL showed up often/)).toBeTruthy();
    expect(screen.queryByText(/mmol/)).toBeNull();
  });

  it("shows the clinician the full numbers, five bands and the pattern settings, and says it raises nothing", () => {
    mockReadings.mockReturnValue(ok(fortnight()));
    render(<AgpCard patientId="p" audience="clinician" />);
    expect(screen.getByText("Glucose management indicator")).toBeTruthy();
    expect(screen.getByText("Variability (CV)")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByText(/raises no task and no page/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /message your care team/i })).toBeNull();
  });

  it("with too little data it shows the range so far and no profile", () => {
    mockReadings.mockReturnValue(ok(fortnight({ days: 3 })));
    render(<AgpCard patientId="p" audience="patient" />);
    expect(screen.getByText(/\(so far\)/)).toBeTruthy();
    expect(screen.getByText(/fills in once about 10 days/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("never states a cause, a dose or a medicine", () => {
    mockReadings.mockReturnValue(ok(fortnight()));
    for (const audience of ["patient", "clinician"] as const) {
      const { container, unmount } = render(<AgpCard patientId="p" audience={audience} />);
      expect(container.textContent ?? "").not.toMatch(/insulin|units?\b|dose|reduce|increase|because|caused|your doctor|—/i);
      unmount();
    }
  });
});
