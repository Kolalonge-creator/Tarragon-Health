/** @jest-environment jsdom */
/**
 * The rotate form shows the new secret once, in a panel that can be dismissed, and never puts it in the address. The switch-back-on
 * form needs a typed reason. (S10y)
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RotateKeyForm, ReenableForm } from "./partner-forms";

const SECRET = "a".repeat(64);
const mockRotate = jest.fn();
const mockReenable = jest.fn();
jest.mock("@/lib/event-bus/partners-actions", () => ({
  rotatePartnerSecretAction: (...a: unknown[]) => mockRotate(...a),
  reenablePartnerEndpointAction: (...a: unknown[]) => mockReenable(...a),
  saveMappingAction: jest.fn(),
  removeMappingAction: jest.fn(),
}));

const ID = "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10";

describe("RotateKeyForm", () => {
  beforeEach(() => {
    mockRotate.mockReset();
    window.history.replaceState(null, "", "/");
  });

  it("shows the secret once with the grace end, then hides it for good on dismiss", async () => {
    mockRotate.mockResolvedValue({ status: "ok", endpointId: ID, secret: SECRET, graceEndsAt: "2026-10-21T10:00:00Z" });
    render(<RotateKeyForm endpointId={ID} inGrace={false} locale="en" />);
    fireEvent.click(screen.getByLabelText(/shown only once/i));
    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }));

    const box = await screen.findByDisplayValue(SECRET);
    expect(box.hasAttribute("readonly")).toBe(true);
    expect(screen.queryByText(/old secret stops working/i)).not.toBeNull();
    expect(window.location.href).not.toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: /hide it/i }));
    await waitFor(() => expect(screen.queryByDisplayValue(SECRET)).toBeNull());
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("does not show a secret when the action fails, and says why", async () => {
    mockRotate.mockResolvedValue({ status: "error", message: "busops.partners.error.failed" });
    render(<RotateKeyForm endpointId={ID} inGrace={false} locale="en" />);
    fireEvent.click(screen.getByLabelText(/shown only once/i));
    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/did not go through/i);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("disables rotation inside a grace window", () => {
    render(<RotateKeyForm endpointId={ID} inGrace locale="en" />);
    expect((screen.getByRole("button", { name: "Rotate key" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ReenableForm", () => {
  it("explains what happens next and has a required reason box", () => {
    render(<ReenableForm endpointId={ID} locale="en" />);
    expect(screen.queryByText(/switched off again after the same number of failures/i)).not.toBeNull();
    expect((screen.getByLabelText(/why is it safe/i) as HTMLTextAreaElement).required).toBe(true);
  });
});
