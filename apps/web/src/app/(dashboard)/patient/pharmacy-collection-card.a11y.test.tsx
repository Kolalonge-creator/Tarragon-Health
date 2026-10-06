/** @jest-environment jsdom */
/**
 * S28: the patient's "collect from a pharmacy" card. Choosing needs a pharmacy AND the tick-box, the code shows only while
 * the prescription is waiting, an out-of-stock flag sends her back to choose, there is no delivery option anywhere, and the
 * card has no accessibility violations in any of its states.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { PharmacyCollectionCard } from "./pharmacy-collection-card";
import type { CollectionPrescription } from "@/lib/pharmacy-collection/load";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const loadPharmacyOptions = jest.fn();
const sendToPharmacy = jest.fn();
const reroutePharmacy = jest.fn();
const withdrawFromPharmacy = jest.fn();
jest.mock("@/lib/pharmacy-collection/actions", () => ({
  withdrawFromPharmacy: (...a: unknown[]) => withdrawFromPharmacy(...a),
  loadPharmacyOptions: (...a: unknown[]) => loadPharmacyOptions(...a),
  sendToPharmacy: (...a: unknown[]) => sendToPharmacy(...a),
  reroutePharmacy: (...a: unknown[]) => reroutePharmacy(...a),
}));

const OPTION = {
  pharmacy_partner_id: "5c1d9f1e-8a2b-4d37-9c64-2e7b6a1d3f90", name: "Yaba Pharmacy", address: null, city: "Lagos", state: "Lagos", area: "Yaba",
  items_total: 2, items_priced: 1, total_kobo: 380000, stock: "low_stock" as const, is_preferred: true,
};
const signed: CollectionPrescription = { id: "rx1", state: "signed", medicines: ["Amlodipine"], pharmacy: null };
const waiting: CollectionPrescription = {
  id: "rx2", state: "sent", medicines: ["Losartan"],
  pharmacy: { sent: true, state: "sent", pharmacy_name: "Yaba Pharmacy", pharmacy_area: "Yaba", collection_code: "K7M2QX9P", needs_other_pharmacy: false },
};

beforeEach(() => {
  refresh.mockReset();
  loadPharmacyOptions.mockReset().mockResolvedValue({ ok: true, options: [OPTION] });
  sendToPharmacy.mockReset().mockResolvedValue({ ok: true, code: "K7M2QX9P", pharmacyName: "Yaba Pharmacy" });
  reroutePharmacy.mockReset().mockResolvedValue({ ok: true, code: "ABCDEFGH", pharmacyName: "B" });
  withdrawFromPharmacy.mockReset().mockResolvedValue({ ok: true, key: "pharmacy.withdraw.done" });
});

describe("PharmacyCollectionCard", () => {
  it("renders nothing when there is no prescription", () => {
    const { container } = render(<PharmacyCollectionCard prescriptions={[]} locale="en" />);
    expect(container.innerHTML).toBe("");
  });

  it("asks for a pharmacy and the tick before it will send, then sends once", async () => {
    render(<PharmacyCollectionCard prescriptions={[signed]} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a pharmacy" }));
    await screen.findByText("Yaba Pharmacy", undefined, { timeout: 5000 });
    const send = screen.getByRole("button", { name: "Send to this pharmacy" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio"));
    expect(send.disabled).toBe(true); // a pharmacy alone is not enough
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(sendToPharmacy).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(sendToPharmacy).toHaveBeenCalledWith({ prescriptionId: "rx1", partnerId: OPTION.pharmacy_partner_id, consent: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 5000 });
  });

  it("ticks the last pharmacy already, so a repeat needs only the consent tick", async () => {
    render(<PharmacyCollectionCard prescriptions={[signed]} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a pharmacy" }));
    await screen.findByText("Yaba Pharmacy", undefined, { timeout: 5000 });
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(true);
    const send = screen.getByRole("button", { name: "Send to this pharmacy" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // still never without her tick
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send.disabled).toBe(false);
  });

  it("opens at #pharmacy-collection, where the refill reminder lands", () => {
    const { container } = render(<PharmacyCollectionCard prescriptions={[signed]} locale="en" />);
    expect(container.querySelector("#pharmacy-collection")).toBeTruthy();
  });

  it("acting for someone: who it is for goes with the options, the send and the take-back", async () => {
    const WHO = "9d8c7b6a-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
    render(<PharmacyCollectionCard prescriptions={[signed, waiting]} locale="en" beneficiaryId={WHO} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a pharmacy" }));
    await screen.findByText("Yaba Pharmacy", undefined, { timeout: 5000 });
    expect(loadPharmacyOptions).toHaveBeenCalledWith("rx1", WHO);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send to this pharmacy" }));
    await waitFor(() => expect(sendToPharmacy).toHaveBeenCalledWith({ prescriptionId: "rx1", partnerId: OPTION.pharmacy_partner_id, consent: true, beneficiaryId: WHO }), { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Take it back from this pharmacy" }));
    await waitFor(() => expect(withdrawFromPharmacy).toHaveBeenCalledWith("rx2", WHO), { timeout: 5000 });
  });

  it("always says the downloaded form can go to any pharmacy, in every state", () => {
    for (const p of [signed, waiting]) {
      const { unmount } = render(<PharmacyCollectionCard prescriptions={[p]} locale="en" />);
      expect(screen.getByText("Take the downloaded form to any pharmacy")).toBeTruthy();
      unmount();
    }
  });

  it("shows the price for the items it could price, honestly, and the stock", async () => {
    render(<PharmacyCollectionCard prescriptions={[signed]} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a pharmacy" }));
    await screen.findByText(/1 of 2 items/, undefined, { timeout: 5000 });
    expect(screen.getByText(/₦3,800\.00/)).toBeTruthy();
    expect(screen.getByText(/Running low/)).toBeTruthy();
    expect(screen.getByText(/Where you collected last time/)).toBeTruthy();
  });

  it("says plainly when no pharmacy is open", async () => {
    loadPharmacyOptions.mockResolvedValue({ ok: true, options: [] });
    render(<PharmacyCollectionCard prescriptions={[signed]} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a pharmacy" }));
    await screen.findByText(/No partner pharmacy is open for collection yet/, undefined, { timeout: 5000 });
  });

  it("shows the code while waiting and offers a different pharmacy", () => {
    render(<PharmacyCollectionCard prescriptions={[waiting]} locale="en" />);
    expect(screen.getByText("K7M2QX9P")).toBeTruthy();
    expect(screen.getByText(/Sent to Yaba Pharmacy/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a different pharmacy" })).toBeTruthy();
  });

  it("she can take it back, and is told the pharmacy can no longer see it", async () => {
    render(<PharmacyCollectionCard prescriptions={[waiting]} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Take it back from this pharmacy" }));
    await screen.findByText(/can no longer see your prescription/, undefined, { timeout: 5000 });
    expect(withdrawFromPharmacy).toHaveBeenCalledWith("rx2", undefined);
    expect(refresh).toHaveBeenCalled();
  });

  it("an out-of-stock flag hides the code and asks her to choose again", () => {
    const flagged = { ...waiting, pharmacy: { ...waiting.pharmacy!, needs_other_pharmacy: true } } as CollectionPrescription;
    render(<PharmacyCollectionCard prescriptions={[flagged]} locale="en" />);
    expect(screen.queryByText("K7M2QX9P")).toBeNull();
    expect(screen.getByText(/could not supply this/)).toBeTruthy();
  });

  it("a collected prescription shows no code", () => {
    const done: CollectionPrescription = { ...waiting, state: "dispensed", pharmacy: { sent: true, state: "dispensed", pharmacy_name: "Yaba Pharmacy", collection_code: null, needs_other_pharmacy: false } };
    render(<PharmacyCollectionCard prescriptions={[done]} locale="en" />);
    expect(screen.queryByText("K7M2QX9P")).toBeNull();
    expect(screen.getByText(/Collected from Yaba Pharmacy/)).toBeTruthy();
  });

  it("has no delivery option: no control or choice mentions delivery (Part C.2)", async () => {
    render(<PharmacyCollectionCard prescriptions={[signed, waiting]} locale="en" />);
    fireEvent.click(screen.getAllByRole("button", { name: /pharmacy/i })[0]!);
    await screen.findByText("Yaba Pharmacy", undefined, { timeout: 5000 });
    for (const el of [...screen.queryAllByRole("button"), ...screen.queryAllByRole("radio"), ...screen.queryAllByRole("checkbox")]) {
      expect(`${el.textContent} ${el.getAttribute("aria-label") ?? ""}`).not.toMatch(/deliver/i);
    }
  });

  it("speaks Pidgin when asked", () => {
    render(<PharmacyCollectionCard prescriptions={[signed]} locale="pcm" />);
    expect(screen.getByRole("button", { name: "Pick pharmacy" })).toBeTruthy();
  });

  it("has no axe violations while waiting", async () => {
    await expectNoA11yViolations(<PharmacyCollectionCard prescriptions={[waiting]} locale="en" />);
  });

  it("has no axe violations while choosing", async () => {
    const { container } = render(<PharmacyCollectionCard prescriptions={[signed, waiting]} locale="en" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Choose a pharmacy" })[0]!);
    await screen.findByText("Yaba Pharmacy", undefined, { timeout: 5000 });
    expect(await axe(container)).toHaveNoViolations();
  });
});
