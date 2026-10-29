/** @jest-environment jsdom */
/**
 * The form where a patient checks and confirms the numbers read from their own uploaded report. It must send exactly what the person
 * sees (including a correction), say plainly that a doctor has not checked the numbers, and refuse an empty or non-numeric entry
 * before anything is sent.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { ReportedValuesConfirm, type ReportDraft } from "./reported-values-confirm";

const confirmMyLabReport = jest.fn();
jest.mock("./actions", () => ({ confirmMyLabReport: (...args: unknown[]) => confirmMyLabReport(...args) }));

const DRAFT: ReportDraft = {
  document_id: "d1",
  extraction_id: "11111111-1111-4111-8111-111111111111",
  filename: "hba1c-report.pdf",
  report_date: "2026-10-01",
  confirmed: false,
  rows: [
    { code: "hba1c", label: "HbA1c", value: 6.8, unit: "%" },
    { code: "ldl", label: "LDL", value: 3.4, unit: "mmol/L" },
  ],
};

beforeEach(() => confirmMyLabReport.mockReset());

describe("ReportedValuesConfirm", () => {
  it("renders nothing when there is nothing to confirm", () => {
    const { container } = render(<ReportedValuesConfirm drafts={[]} uiLanguage="en" />);
    expect(container.innerHTML).toBe("");
  });

  it("says a doctor has not checked the numbers", () => {
    render(<ReportedValuesConfirm drafts={[DRAFT]} uiLanguage="en" />);
    expect(screen.getByText(/A doctor has not checked them/i)).toBeTruthy();
  });

  it("sends the corrected value, the report date and the unit, and shows the saved message", async () => {
    confirmMyLabReport.mockResolvedValue({ ok: true, saved: 2 });
    render(<ReportedValuesConfirm drafts={[DRAFT]} uiLanguage="en" />);
    fireEvent.change(screen.getByLabelText("HbA1c"), { target: { value: "6.9" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm these numbers/i }));
    await waitFor(() => expect(confirmMyLabReport).toHaveBeenCalledTimes(1));
    expect(confirmMyLabReport).toHaveBeenCalledWith({
      extractionId: DRAFT.extraction_id,
      reportDate: "2026-10-01",
      readings: [
        { code: "hba1c", value: 6.9, unit: "%" },
        { code: "ldl", value: 3.4, unit: "mmol/L" },
      ],
    });
    expect((await screen.findByRole("status")).textContent).toMatch(/Saved/);
  });

  it("does not send a blank value", async () => {
    render(<ReportedValuesConfirm drafts={[DRAFT]} uiLanguage="en" />);
    fireEvent.change(screen.getByLabelText("LDL"), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("button", { name: /confirm these numbers/i }).closest("form")!);
    expect(confirmMyLabReport).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("shows the database's message when saving is refused", async () => {
    confirmMyLabReport.mockResolvedValue({ ok: false, error: "give the date printed on the report" });
    render(<ReportedValuesConfirm drafts={[DRAFT]} uiLanguage="en" />);
    fireEvent.click(screen.getByRole("button", { name: /confirm these numbers/i }));
    expect((await screen.findByRole("alert")).textContent).toBe("give the date printed on the report");
  });

  it("has no axe violations", async () => {
    await expectNoA11yViolations(<ReportedValuesConfirm drafts={[DRAFT]} uiLanguage="en" />);
  });
});
