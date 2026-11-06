/** @jest-environment jsdom */
/**
 * P11 (spec 9.2): several files go in one send, each noted with its page number; a refused file stays chosen with its reason
 * while the rest go through; a camera input is offered.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sent: FormData[] = [];
jest.mock("@/lib/lab-results/actions", () => ({
  uploadResultDocumentAsPatient: async (fd: FormData) => {
    sent.push(fd);
    return (fd.get("file") as File).name === "page1.jpg" ? { error: "That photo is too blurry to read." } : { error: null };
  },
}));
jest.mock("@/app/(dashboard)/patient/lab-result-consult-actions", () => ({ cancelLabResultConsultRequest: jest.fn() }));
jest.mock("@/lib/queries/lab-result-consult", () => ({ useMyLabResultConsultRequests: () => ({ data: [] }), labResultConsultKeys: { myRequests: () => [] } }));
jest.mock("@/lib/queries/lab-orders", () => ({ usePatientLabOrders: () => ({ data: [] }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import { PatientResultUpload } from "./patient-result-upload";

const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });

beforeEach(() => (sent.length = 0));

it("sends each file with its page number and keeps only the refused one for another try", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PatientResultUpload labOrderId="11111111-1111-1111-1111-111111111111" testCode="hba1c" />
    </QueryClientProvider>,
  );
  const picker = screen.getByLabelText("Upload your result");
  expect(picker.hasAttribute("multiple")).toBe(true);
  expect(document.querySelector('input[capture="environment"]')).not.toBeNull();

  fireEvent.change(picker, { target: { files: [jpg("page1.jpg"), jpg("page2.jpg")] } });
  fireEvent.click(screen.getByRole("button", { name: "Send 2 files to my care team" }));

  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent.map((fd) => fd.get("note"))).toEqual(["Page 1 of 2.", "Page 2 of 2."]);
  expect(sent.every((fd) => fd.get("test_code") === "hba1c")).toBe(true);

  await screen.findByText("1 sent to your care team. 1 did not send: see below.");
  expect(screen.getByText("That photo is too blurry to read.")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Files to send" }).textContent).toContain("page1.jpg");
  expect(screen.getByRole("list", { name: "Files to send" }).textContent).not.toContain("page2.jpg");

  // Sent again on its own, the failed page keeps its original page number.
  sent.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "Send to my care team" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]!.get("note")).toBe("Page 1 of 2.");
});
