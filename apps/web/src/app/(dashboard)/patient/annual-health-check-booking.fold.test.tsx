/** @jest-environment jsdom */
/**
 * Design audit P3: the confidential and "other" test lists are folded. A test in a folded list must never be preselected,
 * or a "Get & print" button would appear for a confidential screening the patient never chose or saw.
 */
import { render, screen, fireEvent } from "@testing-library/react";

const bundle = (code: string, name: string) => ({ id: code, code, name, price_kobo: 1000, self_bookable: true, test_codes: [code], category: null });
let bundles: unknown[] = [];

jest.mock("@/lib/queries/lab-orders", () => ({
  useLabCatalogue: () => ({ data: bundles }),
  usePatientLabOrders: () => ({ data: [], isError: false }),
  useCreateLabOrder: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useScreenTypeDetails: () => ({ data: null }),
}));
jest.mock("./review-price", () => ({ ReviewPrice: () => null }));
jest.mock("@/components/confidential-result-notice", () => ({ ConfidentialResultNotice: () => null }));
jest.mock("@/components/patient-result-upload", () => ({ PatientResultUpload: () => null }));
jest.mock("@/components/ecg-report-upload", () => ({ EcgReportUpload: () => null }));
jest.mock("@/components/lab-order-test-checklist", () => ({ LabOrderTestChecklist: () => null }));
jest.mock("@/components/pay-for-lab-order-button", () => ({ PayForLabOrderButton: () => null }));
jest.mock("@/components/redeem-voucher-button", () => ({ RedeemVoucherButton: () => null }));
jest.mock("@/components/lab-specimen-tracker", () => ({ LabSpecimenTracker: () => null }));

import { AnnualHealthCheckBooking } from "./annual-health-check-booking";

describe("AnnualHealthCheckBooking folded lists", () => {
  it("does not preselect a confidential test when there is no package", () => {
    bundles = [bundle("single_hiv", "HIV Screening")];
    render(<AnnualHealthCheckBooking patientId="p1" organisationId="o1" />);
    expect(screen.queryByRole("button", { name: /Get & print/ })).toBeNull();
  });

  it("offers Get & print only after the patient picks the test from the opened list", () => {
    bundles = [bundle("single_hiv", "HIV Screening")];
    const { container } = render(<AnnualHealthCheckBooking patientId="p1" organisationId="o1" />);
    fireEvent.click(screen.getByText("Confidential screenings"));
    fireEvent.click(container.querySelector("details button") as HTMLElement);
    expect(screen.getByRole("button", { name: /Get & print HIV Screening/ })).not.toBeNull();
  });

  it("still preselects the core package", () => {
    bundles = [bundle("screen_core", "Core Screen"), bundle("single_hiv", "HIV Screening")];
    render(<AnnualHealthCheckBooking patientId="p1" organisationId="o1" />);
    expect(screen.getByRole("button", { name: /Get & print Core Screen/ })).not.toBeNull();
  });
});
