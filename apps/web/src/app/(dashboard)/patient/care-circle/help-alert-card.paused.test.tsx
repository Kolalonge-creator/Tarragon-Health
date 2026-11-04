/** @jest-environment jsdom */
/**
 * Care Circle P1 (founder decision D-help, 2026-11-04): while the circle's alerts are paused the help button still sends, and the patient
 * is told so BEFORE pressing it, and again after.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let paused = true;
const rpc = jest.fn(async (name: string) => {
  if (name === "my_care_circle") {
    return {
      data: { members: [], invites: [], offers: [], pause: paused ? { paused_until: "2026-11-11T00:00:00Z", pause_alerts: true } : null, pause_days: 7 },
      error: null,
    };
  }
  if (name === "send_circle_help_alert") {
    return { data: { alert_id: "a1", already_sent: false, recipients_told: 2, location_shared: false, circle_paused: paused }, error: null };
  }
  return { data: null, error: null };
});
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { granted: false }, error: null }) }) }) }),
    rpc,
  }),
}));

import { HelpAlertCard } from "./help-alert-card";

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HelpAlertCard patientId="p1" locale="en" />
    </QueryClientProvider>,
  );
}

describe("HelpAlertCard while paused", () => {
  beforeEach(() => rpc.mockClear());

  it("warns before sending, still sends, and says it was sent", async () => {
    paused = true;
    renderIt();
    expect(await screen.findByText(/Your Care Circle is paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("send_circle_help_alert", {}));
    expect(await screen.findByText(/this alert was still sent/)).toBeTruthy();
  });

  it("says nothing about a pause when there is none", async () => {
    paused = false;
    renderIt();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_care_circle"));
    expect(screen.queryByText(/Your Care Circle is paused/)).toBeNull();
  });
});
