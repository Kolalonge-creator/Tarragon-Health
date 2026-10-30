/** @jest-environment jsdom */
/**
 * Regression test (2026-10-28): with a signed version in force and a newer drafted version waiting, the panel showed "Signed" and NO sign
 * form, so the CMO could never sign the draft from the hub. A waiting draft must offer a sign form carrying that draft's id.
 */
import { render, screen } from "@testing-library/react";

jest.mock("./actions", () => ({ signLabPanels: jest.fn() }));

import { LabPanelsView } from "./lab-panels-view";

const signed = { id: "active-3", version: 3, approved_at: "2026-10-13T00:00:00Z", created_at: "2026-10-13T00:00:00Z", config: {} };
const draft = { id: "draft-4", version: 4, notes: "adds the anti-HBs add-on", created_at: "2026-10-21T00:00:00Z" };

describe("LabPanelsView", () => {
  it("offers a sign form for the waiting draft even though the version in force is signed", () => {
    const { container } = render(<LabPanelsView signoff={signed} draft={draft} panels={[]} canSign />);
    expect(screen.getByText(/Sign version 4 of the lab ranges/)).toBeTruthy();
    expect((container.querySelector('input[name="id"]') as HTMLInputElement).value).toBe("draft-4");
  });
  it("shows no sign form when nothing waits, or when the viewer cannot sign", () => {
    render(<LabPanelsView signoff={signed} panels={[]} canSign />);
    expect(screen.queryByText(/Sign version/)).toBeNull();
    render(<LabPanelsView signoff={signed} draft={draft} panels={[]} canSign={false} />);
    expect(screen.queryByText(/Sign version/)).toBeNull();
  });
});
