/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * S47 (decision 4): the share form pre-fills what the database defaults to: a 72 hour expiry, a view cap of 10, no PIN, nothing selected. The numbers come from the
 * active record_share_config row, never from the page, so the form and the function cannot disagree.
 */
const mutateAsync = jest.fn();
const config: { default_hours: number; max_hours: number; min_pin_length: number; default_max_views: number | null } | null = {
  default_hours: 72,
  max_hours: 720,
  min_pin_length: 4,
  default_max_views: 10,
};

jest.mock("@/lib/queries/record-shares", () => ({
  SHARE_SECTIONS: ["vitals", "medications", "conditions", "allergies", "lab_results", "vaccinations", "emergency_info", "procedures", "family_history"],
  useRecordShares: () => ({ data: [], isLoading: false }),
  useRecordShareAttempts: () => ({ data: [] }),
  useRecordShareConfig: () => ({ data: config }),
  useCreateRecordShare: () => ({ mutateAsync, isPending: false }),
  useRevokeRecordShare: () => ({ mutate: jest.fn(), isPending: false }),
  recordShareUrl: (t: string) => `https://example.test/share/${t}`,
}));
jest.mock("qrcode", () => ({ toDataURL: async () => "data:image/png;base64,AAAA" }), { virtual: true });

import { ShareControls } from "./share-controls";

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ id: "1", token: "t", sections: ["vitals"], expires_at: "x", created_at: "x", has_pin: false, max_views: 10 });
});

describe("ShareControls defaults", () => {
  it("pre-fills the view cap with the configured 10, selects no section and offers an optional PIN", () => {
    render(<ShareControls patientId="p" />);
    expect((screen.getByLabelText(/how many times it can be opened/i) as HTMLInputElement).value).toBe("10");
    for (const box of screen.getAllByRole("checkbox")) expect((box as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/pin/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: /create/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("creates the link with the default cap and the default expiry unless the person changes them", async () => {
    render(<ShareControls patientId="p" />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ maxViews: 10, expiresInHours: undefined, pin: undefined, sections: ["vitals"] }));
  });

  it("a number the person types wins over the default", async () => {
    render(<ShareControls patientId="p" />);
    fireEvent.change(screen.getByLabelText(/how many times it can be opened/i), { target: { value: "3" } });
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ maxViews: 3 }));
  });
});
