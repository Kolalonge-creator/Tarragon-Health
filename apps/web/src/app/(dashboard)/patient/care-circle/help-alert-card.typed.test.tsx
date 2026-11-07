/** @jest-environment jsdom */
/**
 * P22 / PD-08 (founder, 2026-11-06): the patient picks what kind of help they want and may add a short note. The "not an emergency
 * service" line is always on the card. Nothing is sent until a kind is chosen.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let sendError: { code: string; message: string } | null = null;
let missingTyped = false;
const rpc = jest.fn(async (name: string, args?: Record<string, unknown>) => {
  if (name === "my_care_circle") return { data: { members: [], invites: [], offers: [], pause: null, pause_days: 7 }, error: null };
  if (name === "send_circle_help_alert") {
    if (missingTyped && args && "p_request_type" in args) return { data: null, error: { code: "PGRST202", message: "no function" } };
    if (sendError) return { data: null, error: sendError };
    return { data: { alert_id: "a1", already_sent: false, recipients_told: 1, location_shared: false, circle_paused: false }, error: null };
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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <HelpAlertCard patientId="p1" locale="en" />
    </QueryClientProvider>,
  );
}

function sends() {
  return rpc.mock.calls.filter(([n]) => n === "send_circle_help_alert");
}

describe("HelpAlertCard typed requests", () => {
  beforeEach(() => {
    rpc.mockClear();
    sendError = null;
    missingTyped = false;
  });

  it("offers the five kinds of help and always says it is not an emergency service", () => {
    renderIt();
    for (const name of ["Help booking an appointment", "Help paying for a test", "Collecting my medicines", "Transport to get somewhere", "Please call me"]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    }
    expect(screen.getByText(/This is not an emergency service\. If you need care now, go to the nearest hospital\./)).toBeTruthy();
    // founder-approved intro, 2026-11-07 (replaces "One tap tells...")
    expect(screen.getByText("Ask the people in your Care Circle for help. Pick what you need and they get a message.")).toBeTruthy();
    expect(screen.queryByText(/One tap/)).toBeNull();
  });

  it("sends nothing until a kind is chosen, and says so", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    expect(await screen.findByText("Choose what you would like help with first.")).toBeTruthy();
    expect(sends()).toHaveLength(0);
  });

  it("sends the kind and the trimmed note", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("radio", { name: "Help paying for a test" }));
    fireEvent.change(screen.getByLabelText("A short note (optional)"), { target: { value: "  The lab asked for payment first  " } });
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("send_circle_help_alert", { p_request_type: "test_payment", p_note: "The lab asked for payment first" }),
    );
    expect(await screen.findByText(/Your Care Circle has been told/)).toBeTruthy();
  });

  it("the note box stops at 200 characters", () => {
    renderIt();
    expect(screen.getByLabelText("A short note (optional)").getAttribute("maxlength")).toBe("200");
  });

  it("still asks for help in the deploy window, before the database has the typed version", async () => {
    missingTyped = true;
    renderIt();
    fireEvent.click(screen.getByRole("radio", { name: "Please call me" }));
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("send_circle_help_alert", {}));
    expect(await screen.findByText(/Your Care Circle has been told/)).toBeTruthy();
  });

  it("explains a refused request instead of failing silently", async () => {
    sendError = { code: "22023", message: "unknown kind of help" };
    renderIt();
    fireEvent.click(screen.getByRole("radio", { name: "Transport to get somewhere" }));
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    expect(await screen.findByText(/Please choose what you need help with and keep the note under 200 characters/)).toBeTruthy();
  });

  it("any other failure tells the patient to call someone or go to the nearest hospital", async () => {
    sendError = { code: "XX000", message: "boom" };
    renderIt();
    fireEvent.click(screen.getByRole("radio", { name: "Please call me" }));
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    expect(await screen.findByText(/The alert could not be sent/)).toBeTruthy();
  });
});
