/** @jest-environment jsdom */
/**
 * T2-11: the prescription PDF is the main path and works with no partner pharmacy. "Choose where to collect" appears only when a
 * partner pharmacy can actually take the prescription, so the screen never implies a contracted pharmacy that does not exist.
 */
import { render, screen } from "@testing-library/react";

let partnerAvailable: boolean | undefined = false;
const partnerHook = jest.fn((enabled: boolean) => ({ data: enabled ? partnerAvailable : undefined }));

jest.mock("@/lib/queries/medications", () => ({
  useDisputePrescriptionSupply: () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null }),
  usePartnerCollectionAvailable: (enabled: boolean) => partnerHook(enabled),
  useUndoPrescriptionCollected: () => ({ mutate: undoMutate, isPending: false, isError: false }),
}));
const undoMutate = jest.fn();

import { PrescriptionDownload } from "./prescription-download";

const PROPS = {
  medicationId: "m1",
  rxNumber: "RX-0001",
  verificationCode: "ABCD1234",
  expiresAt: null,
  supplies: [],
  patientId: "p1",
  prescriptionId: "rx1",
};

beforeEach(() => {
  partnerHook.mockClear();
  partnerAvailable = false;
});

describe("PrescriptionDownload (T2-11 take anywhere)", () => {
  it("with no partner pharmacy, offers the PDF and says any pharmacy, and no collection choice", () => {
    render(<PrescriptionDownload {...PROPS} />);
    const link = screen.getByRole("link", { name: /Download prescription \(PDF\)/ });
    expect(link.getAttribute("href")).toBe("/api/patient/prescriptions/m1/pdf");
    expect(screen.queryByRole("link", { name: /Choose where to collect/ })).toBeNull();
    expect(screen.getByText(/any licensed pharmacy you choose/)).toBeTruthy();
  });

  it("while the availability is still loading, shows no collection choice (fails closed)", () => {
    partnerAvailable = undefined;
    render(<PrescriptionDownload {...PROPS} />);
    expect(screen.queryByRole("link", { name: /Choose where to collect/ })).toBeNull();
  });

  it("with a ready partner pharmacy, also offers the optional collection choice", () => {
    partnerAvailable = true;
    render(<PrescriptionDownload {...PROPS} />);
    expect(screen.getByRole("link", { name: /Download prescription \(PDF\)/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Choose where to collect/ }).getAttribute("href")).toBe("/patient/pharmacy/collect/rx1?for=p1");
  });

  it("does not ask about partners when there is no signed prescription row", () => {
    render(<PrescriptionDownload {...PROPS} prescriptionId={null} />);
    expect(partnerHook).toHaveBeenCalledWith(false);
    expect(screen.getByRole("link", { name: /Download prescription \(PDF\)/ })).toBeTruthy();
  });

  it("T2-11c: labels the patient's own confirmation and offers undo for 24 hours", () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const base = {
      dispensed_on: "2026-11-05",
      pharmacy_name: "Corner Chemist",
      pharmacist_name: null,
      pharmacist_registration: null,
      pharmacist_registration_verified: false,
      disputed_at: null,
      source: "patient" as const,
      recorded_via: "patient_confirmation",
      pharmacy_town: "Ikeja",
    };
    render(
      <PrescriptionDownload
        {...PROPS}
        supplies={[
          { ...base, id: "c1", created_at: recent },
          { ...base, id: "c2", created_at: "2026-10-01T10:00:00Z", dispensed_on: "2026-10-01" },
        ]}
      />
    );
    expect(screen.getByText("You told us you collected this on 5 Nov 2026 at Corner Chemist, Ikeja.")).toBeTruthy();
    const undo = screen.getAllByRole("button", { name: /Undo, I tapped this by mistake/ });
    expect(undo).toHaveLength(1);
    undo[0].click();
    expect(undoMutate).toHaveBeenCalledWith({ dispenseId: "c1" }, expect.any(Object));
    expect(screen.queryByRole("button", { name: /This wasn't me/ })).toBeNull();
  });
});
