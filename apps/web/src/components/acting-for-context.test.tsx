/** @jest-environment jsdom */
/**
 * While managing someone else's account, the upload forms are replaced by a note (the file would land on the signed-in
 * person's own record); outside that, and on staff pages with no provider, the forms are unchanged.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@/lib/lab-results/actions", () => ({ uploadResultDocumentAsPatient: jest.fn() }));
jest.mock("@/lib/ecg-reports/actions", () => ({ uploadEcgReportAsPatient: jest.fn() }));
jest.mock("@/app/(dashboard)/patient/lab-result-consult-actions", () => ({ cancelLabResultConsultRequest: jest.fn() }));
jest.mock("@/lib/queries/lab-result-consult", () => ({ useMyLabResultConsultRequests: () => ({ data: [] }), labResultConsultKeys: { myRequests: () => [] } }));
jest.mock("@/lib/queries/lab-orders", () => ({ usePatientLabOrders: () => ({ data: [] }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import { ActingForProvider } from "./acting-for-context";
import { PatientResultUpload } from "./patient-result-upload";
import { EcgReportUpload } from "./ecg-report-upload";

const wrap = (ui: React.ReactElement, acting: { fullName: string | null } | null) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ActingForProvider value={acting}>{ui}</ActingForProvider>
    </QueryClientProvider>,
  );

it("replaces the upload forms with a note naming the person while managing their account", () => {
  wrap(
    <>
      <PatientResultUpload label="Upload your result" />
      <EcgReportUpload labOrderId="11111111-1111-1111-1111-111111111111" label="Upload your ECG" />
    </>,
    { fullName: "Adaeze Okafor" },
  );
  expect(screen.queryByLabelText("Upload your result")).toBeNull();
  expect(screen.queryByLabelText("Upload your ECG")).toBeNull();
  expect(screen.getAllByText(/Uploading is off while you manage Adaeze's account/)).toHaveLength(2);
});

it("shows the forms when not managing anyone's account", () => {
  wrap(<PatientResultUpload label="Upload your result" />, null);
  expect(screen.getByLabelText("Upload your result")).toBeTruthy();
  expect(screen.queryByText(/Uploading is off/)).toBeNull();
});
