/** @jest-environment jsdom */
/**
 * The glucose profile card for both audiences. The data hook is stubbed: what is under test is what each reader is shown and told, in words,
 * and that nothing here ever turns into advice about a dose.
 */
import { render, screen } from "@testing-library/react";
import { AgpCard } from "./agp-card";
import { AgpReadError } from "@/lib/cgm/agp-read";
import { FIXTURE_NOW, fortnight } from "@/lib/cgm/fixtures/agp-fortnight";

const mockReadings = jest.fn();
let mockUnit: "mg_dl" | "mmol_l" = "mmol_l";
jest.mock("@/lib/queries/cgm", () => ({ useAgpReadings: () => mockReadings() }));
jest.mock("@/components/glucose-unit-provider", () => ({ useGlucoseUnit: () => mockUnit }));

const ok = (samples: { takenAt: string; mmolL: number }[], truncated = false) => ({ data: { samples, fetchedAt: FIXTURE_NOW, truncated }, isLoading: false, isError: false });

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

  it("says a refusal is a refusal, and an outage is an outage, never that there are no readings", () => {
    mockReadings.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new AgpReadError("denied", "x") });
    const first = render(<AgpCard patientId="p" audience="clinician" />);
    expect(screen.getByRole("status").textContent).toContain("not available to you");
    expect(screen.queryByText(/no readings/i)).toBeNull();
    first.unmount();
    mockReadings.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new AgpReadError("error", "network down") });
    render(<AgpCard patientId="p" audience="clinician" />);
    expect(screen.getByRole("status").textContent).toContain("could not be loaded just now");
    expect(screen.getByRole("status").textContent).not.toContain("not available to you");
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

  it("tells the patient the true reason: too little sensor coverage is not described as too few days", () => {
    mockReadings.mockReturnValue(ok(fortnight({ drop: 0.85 })));
    render(<AgpCard patientId="p" audience="patient" />);
    expect(screen.getByText(/recorded for about 70% of the time/)).toBeTruthy();
    expect(screen.queryByText(/days of sensor readings are in/)).toBeNull();
  });

  it("says when the read hit its row limit instead of blaming the sensor or showing a silently short fortnight", () => {
    mockReadings.mockReturnValue(ok(fortnight({ days: 3 }), true));
    const patient = render(<AgpCard patientId="p" audience="patient" />);
    expect(screen.getByText(/uses the most recent ones/)).toBeTruthy();
    expect(screen.queryByText(/fills in once/)).toBeNull();
    patient.unmount();
    mockReadings.mockReturnValue(ok(fortnight(), true));
    render(<AgpCard patientId="p" audience="clinician" />);
    expect(screen.getByText(/Read limit reached \(5,000 readings per source\)/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /glucose profile over a day/i })).toBeTruthy();
  });

  it("shows a real but tiny time below range as under one percent, never as 0%", () => {
    const samples = fortnight({ everyMin: 5 }).map((x) => ({ ...x, mmolL: 8 }));
    for (let i = 0; i < 12; i++) samples[i * 300] = { ...(samples[i * 300] as { takenAt: string }), mmolL: 2.5 };
    mockReadings.mockReturnValue(ok(samples));
    render(<AgpCard patientId="p" audience="patient" />);
    expect(screen.getByText(/<1% low/)).toBeTruthy();
    expect(screen.queryByText(/\b0% low/)).toBeNull();
  });

  it("gives every chart its own ids so several open at once keep their own name and description", () => {
    mockReadings.mockReturnValue(ok(fortnight()));
    const { container } = render(
      <>
        <AgpCard patientId="a" audience="clinician" />
        <AgpCard patientId="b" audience="clinician" />
      </>,
    );
    const svgs = [...container.querySelectorAll("svg[role='img']")];
    expect(svgs).toHaveLength(2);
    const labels = svgs.map((el) => el.getAttribute("aria-labelledby"));
    expect(labels[0]).not.toBe(labels[1]);
    for (const el of svgs) {
      for (const id of (el.getAttribute("aria-labelledby") ?? "").split(" ")) expect(el.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
    const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
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
