/** @jest-environment jsdom */
/**
 * P22 / PD-08: a supporter sees what kind of help was asked for and the patient's short note, never anything clinical, and the line that
 * this is not an emergency service. An older alert with no kind reads as a plain request to get in touch.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let alert: Record<string, unknown> | null = null;
let fail = false;
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: async () => (fail ? { data: null, error: { message: "you do not support this person", code: "42501" } } : { data: alert, error: null }),
  }),
}));
jest.mock("@/lib/directory/model", () => ({ detectMapsPlatform: () => "web" }));

import { HelpAlertView } from "./help-alert-view";

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HelpAlertView patientId="p1" locale="en" />
    </QueryClientProvider>,
  );
}

const BASE = { alert_id: "a1", sent_at: "2026-11-07T09:00:00Z", latitude: null, longitude: null, accuracy_m: null };

describe("HelpAlertView", () => {
  beforeEach(() => {
    fail = false;
  });

  it("shows the kind of help, the note and the not-an-emergency line", async () => {
    alert = { ...BASE, request_type: "medicine_collection", request_note: "Pharmacy on Allen Avenue, after 4pm" };
    renderIt();
    expect(await screen.findByText("They asked for: Collecting my medicines")).toBeTruthy();
    expect(screen.getByText("Their note: Pharmacy on Allen Avenue, after 4pm")).toBeTruthy();
    expect(screen.getByText(/This is not an emergency service\./)).toBeTruthy();
  });

  it("an older alert with no kind reads as a request to get in touch, with no note line", async () => {
    alert = { ...BASE, request_type: null, request_note: null };
    renderIt();
    expect(await screen.findByText("They asked you to get in touch.")).toBeTruthy();
    expect(screen.queryByText(/Their note/)).toBeNull();
    expect(screen.getByText(/This is not an emergency service\./)).toBeTruthy();
  });

  it("an unknown kind is never shown as raw text", async () => {
    alert = { ...BASE, request_type: "diagnosis", request_note: null };
    renderIt();
    expect(await screen.findByText("They asked you to get in touch.")).toBeTruthy();
    expect(screen.queryByText(/diagnosis/)).toBeNull();
  });

  it("shows nothing to a supporter who may not receive alerts (the database refuses)", async () => {
    fail = true;
    const { container } = renderIt();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });
});
