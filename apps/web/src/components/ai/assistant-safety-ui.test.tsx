/** @jest-environment jsdom */
/**
 * S52 UI: the emergency button shows the BUNDLED guidance at once, with no network, and adds the nearest hospitals when they can be read;
 * the limits panel and the memory card (off by default) render. Uses real components, only the server actions are stubbed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMERGENCY_GUIDANCE } from "@tarragon/shared";
import { expectNoA11yViolations } from "@/test/a11y";

const getEmergencyContextAction = jest.fn();
const getMemoryStateAction = jest.fn();
jest.mock("@/lib/ai-coach/emergency-actions", () => ({ getEmergencyContextAction: (...a: unknown[]) => getEmergencyContextAction(...a) }));
jest.mock("@/lib/ai-coach/memory-actions", () => ({
  getMemoryStateAction: (...a: unknown[]) => getMemoryStateAction(...a),
  setMemoryConsentAction: async () => ({ ok: true }),
  addMemoryItemAction: async () => ({ ok: true }),
  updateMemoryItemAction: async () => ({ ok: true }),
  deleteMemoryItemAction: async () => ({ ok: true }),
  deleteAllMemoryAction: async () => ({ ok: true }),
  exportMemoryAction: async () => ({ ok: true, json: "{}" }),
}));

import { AssistantEmergencyButton } from "./assistant-emergency-button";
import { AssistantLimitsPanel } from "./assistant-limits-panel";
import { AssistantMemoryCard } from "./assistant-memory-card";

describe("the emergency button", () => {
  it("shows the bundled guidance even when the server cannot be reached", async () => {
    getEmergencyContextAction.mockRejectedValue(new Error("offline"));
    render(<AssistantEmergencyButton />);
    fireEvent.click(screen.getByRole("button", { name: "Emergency" }));
    expect(screen.getByRole("alert").textContent).toContain(EMERGENCY_GUIDANCE.lines[0] as string);
    expect(screen.getByRole("alert").textContent).toMatch(/nearest hospital/i);
  });

  it("adds the nearest hospital and the patient's own contact when they can be read", async () => {
    getEmergencyContextAction.mockResolvedValue({
      hospitals: [{ name: "General Hospital Ikeja", city: "Ikeja", address: null, phone: null }],
      contactName: "Ada",
      contactPhone: "+2348012345678",
    });
    render(<AssistantEmergencyButton />);
    fireEvent.click(screen.getByRole("button", { name: "Emergency" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("General Hospital Ikeja"));
    expect(screen.getByRole("alert").textContent).toContain("Your emergency contact is Ada");
  });

  it("has no axe violations open", async () => {
    getEmergencyContextAction.mockResolvedValue({ hospitals: [], contactName: null, contactPhone: null });
    await expectNoA11yViolations(<AssistantEmergencyButton />);
  });
});

describe("the limits panel and the memory card", () => {
  it("states what the assistant cannot do", () => {
    render(<AssistantLimitsPanel />);
    expect(screen.getByText(/cannot diagnose/i)).not.toBeNull();
  });

  it("memory says it is not switched on while the kill switch is off, and remembers nothing", async () => {
    getMemoryStateAction.mockResolvedValue({ available: false, consented: false, textVersion: "mem-v1", maxItems: 30, maxChars: 200, items: [] });
    render(<AssistantMemoryCard />);
    await waitFor(() => expect(screen.getByText(/not switched on yet/i)).not.toBeNull());
  });

  it("memory asks for consent first and offers nothing to add before it", async () => {
    getMemoryStateAction.mockResolvedValue({ available: true, consented: false, textVersion: "mem-v1", maxItems: 30, maxChars: 200, items: [] });
    render(<AssistantMemoryCard />);
    await waitFor(() => expect(screen.getByRole("button", { name: /switch the memory on/i })).not.toBeNull());
    expect(screen.queryByLabelText("What to remember")).toBeNull();
  });
});
