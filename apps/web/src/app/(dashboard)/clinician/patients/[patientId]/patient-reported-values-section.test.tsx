/** @jest-environment jsdom */
/**
 * The doctor's view of numbers a patient confirmed from their own uploaded report. It must say they are not in the clinical record, show
 * nothing when there is nothing (or when a doctor has since filed the report, so nothing appears twice), and never show a flag or range.
 */
import { render, screen } from "@testing-library/react";
import { PatientReportedValuesSection } from "./patient-reported-values-section";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const done = () => Promise.resolve({ data: tables[table] ?? [], error: null });
      for (const m of ["select", "eq", "order", "limit", "in"]) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => done().then(resolve);
      return builder;
    },
  }),
}));

const reported = (id: string, extraction: string, code: string, value: number, unit: string | null) => ({
  id,
  code,
  value,
  unit,
  taken_at: "2026-10-01T12:00:00Z",
  extraction_id: extraction,
  document_id: "doc-1",
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
});

async function renderSection() {
  const ui = await PatientReportedValuesSection({ patientId: "p1" });
  return render(<>{ui}</>);
}

describe("PatientReportedValuesSection", () => {
  it("renders nothing when the patient has confirmed nothing", async () => {
    tables.patient_reported_lab_values = [];
    const { container } = await renderSection();
    expect(container.innerHTML).toBe("");
  });

  it("lists the patient's numbers and says they are not in the clinical record", async () => {
    tables.patient_reported_lab_values = [reported("r1", "e1", "hba1c", 6.9, "%"), reported("r2", "e1", "ldl", 3.4, "mmol/L")];
    tables.lab_report_extractions = [];
    tables.lab_result_documents = [{ id: "doc-1", original_filename: "report.pdf" }];
    await renderSection();
    expect(screen.getByTestId("patient-reported-values")).toBeTruthy();
    expect(screen.getByText(/Not checked by a doctor/)).toBeTruthy();
    expect(screen.getByText(/They are not in the clinical record/)).toBeTruthy();
    expect(screen.getByText("6.9 %")).toBeTruthy();
    expect(screen.getByText("3.4 mmol/L")).toBeTruthy();
    expect(screen.getAllByText("report.pdf").length).toBe(2);
  });

  it("hides a report once a doctor has filed it, so nothing appears twice", async () => {
    tables.patient_reported_lab_values = [reported("r1", "e1", "hba1c", 6.9, "%"), reported("r2", "e2", "ldl", 3.4, "mmol/L")];
    tables.lab_report_extractions = [{ id: "e1", status: "confirmed" }];
    tables.lab_result_documents = [{ id: "doc-1", original_filename: "report.pdf" }];
    await renderSection();
    expect(screen.queryByText("6.9 %")).toBeNull();
    expect(screen.getByText("3.4 mmol/L")).toBeTruthy();
  });

  it("renders nothing when every report has been filed", async () => {
    tables.patient_reported_lab_values = [reported("r1", "e1", "hba1c", 6.9, "%")];
    tables.lab_report_extractions = [{ id: "e1", status: "confirmed" }];
    const { container } = await renderSection();
    expect(container.innerHTML).toBe("");
  });

  it("shows no flag or range column", async () => {
    tables.patient_reported_lab_values = [reported("r1", "e1", "hba1c", 6.9, "%")];
    tables.lab_report_extractions = [];
    tables.lab_result_documents = [];
    await renderSection();
    expect(screen.queryByText(/range/i)).toBeNull();
    expect(screen.queryByText(/flag|high|low|abnormal/i)).toBeNull();
  });
});
