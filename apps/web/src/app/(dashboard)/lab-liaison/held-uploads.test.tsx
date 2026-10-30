/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { HeldUploads } from "./held-uploads";

const ROW = {
  lab_result_id: "11111111-1111-4111-8111-111111111111",
  received_at: "2026-10-30T09:00:00.000Z",
  order_number: "LO-1",
  patient_number: "TH-100",
  file_name: "cbc.pdf",
  status: "waiting_for_review" as const,
};

describe("HeldUploads", () => {
  it("says nothing has been recorded when the read worked and returned no rows", () => {
    render(<HeldUploads rows={[]} />);
    expect(screen.getByText(/Nothing recorded yet/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns, and does not say nothing was recorded, when the read failed", () => {
    render(<HeldUploads rows={[]} failed />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(screen.getByRole("alert").textContent).toMatch(/do not upload them again/);
    expect(screen.queryByText(/Nothing recorded yet/)).toBeNull();
  });

  it("lists the files when there are some", () => {
    render(<HeldUploads rows={[ROW]} />);
    expect(screen.getByText(/TH-100/)).toBeTruthy();
    expect(screen.getByText("Waiting for review")).toBeTruthy();
  });
});
