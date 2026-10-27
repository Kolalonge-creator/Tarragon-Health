/** @jest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { t } from "@tarragon/i18n";
import type { CheckbackView } from "@/lib/symptom-checkback/model";

const submit = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock("./actions", () => ({ submitCheckbackAction: (i: unknown) => submit(i) }));
jest.mock("../../symptom-next-steps", () => ({ SymptomNextSteps: (p: { category: string }) => <div data-testid="next-steps">{p.category}</div> }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: unknown }) => <a href={p.href}>{p.children as never}</a> }));

import { CheckbackForm } from "./checkback-form";

const ID = "11111111-1111-4111-8111-111111111111";
const view = (over: Partial<CheckbackView> = {}): CheckbackView => ({
  id: ID,
  state: "open",
  assessment_id: "22222222-2222-4222-8222-222222222222",
  due_at: "2026-10-23T10:00:00Z",
  opened_at: "2026-10-23T10:00:00Z",
  category: "routine",
  urgency_level: null,
  complaint_key: "headache",
  complaint_label: "Headache",
  checked_at: "2026-10-22T10:00:00Z",
  hours_since_check: 30,
  same_nudge_after_hours: 24,
  sign_vocabulary: ["fever", "neck_stiffness", "confusion"],
  capture: { presentingComplaintKey: "headache", onset: "gradual", severity: 4, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} },
  protocol_version: 1,
  outcome: null,
  ...over,
});
const outcome = (action: string, over: Record<string, unknown> = {}) => ({
  ok: true,
  complaintKey: "headache",
  outcome: { action, escalated: action === "escalate" || action === "emergency", alert_raised: action === "escalate", emergency: action === "emergency", doctor_access: true, assessment_id: "22222222-2222-4222-8222-222222222222", ...over },
});

beforeEach(() => {
  submit.mockReset();
});
afterEach(() => {
  cleanup();
});

const pick = (name: string) => fireEvent.click(screen.getByLabelText(name));
const send = () => fireEvent.click(screen.getByRole("button", { name: t("symptom.checkback.submit") }));

describe("CheckbackForm", () => {
  it("cannot be sent without a better/same/worse answer, and 'did you get care' is optional", async () => {
    submit.mockResolvedValue(outcome("close"));
    render(<CheckbackForm view={view()} safetyNet={null} />);
    expect((screen.getByRole("button", { name: t("symptom.checkback.submit") }) as HTMLButtonElement).disabled).toBe(true);
    pick(t("symptom.checkback.progress.better"));
    send();
    await waitFor(() => expect(screen.getByText(t("symptom.checkback.result.close"))).toBeTruthy());
    expect(submit).toHaveBeenCalledWith({ checkbackId: ID, progress: "better", care: null, signs: [] });
    expect(screen.queryByTestId("next-steps")).toBeNull();
  });

  it("worse escalates and offers the doors for an urgent result, with the generic safety net and the shared label", async () => {
    submit.mockResolvedValue(outcome("escalate"));
    render(<CheckbackForm view={view()} safetyNet={null} />);
    pick(t("symptom.checkback.progress.worse"));
    pick(t("symptom.checkback.care.not_yet"));
    send();
    await waitFor(() => expect(screen.getByText(t("symptom.checkback.result.escalate"))).toBeTruthy());
    expect(screen.getByText(t("symptom.checkback.result.told"))).toBeTruthy();
    expect(screen.getByTestId("next-steps").textContent).toBe("urgent");
    expect(screen.getByTestId("safety-net")).toBeTruthy();
    expect(screen.getByTestId("not-a-diagnosis")).toBeTruthy();
    expect(submit).toHaveBeenCalledWith({ checkbackId: ID, progress: "worse", care: "not_yet", signs: [] });
  });

  it("a plan without doctor time is told the truth: no 'we have told your care team'", async () => {
    submit.mockResolvedValue(outcome("escalate", { alert_raised: false, doctor_access: false }));
    render(<CheckbackForm view={view()} safetyNet={null} />);
    pick(t("symptom.checkback.progress.worse"));
    send();
    await waitFor(() => expect(screen.getByText(t("symptom.checkback.result.no_doctor"))).toBeTruthy());
    expect(screen.queryByText(t("symptom.checkback.result.told"))).toBeNull();
  });

  it("'same' points toward a booking", async () => {
    submit.mockResolvedValue(outcome("book"));
    render(<CheckbackForm view={view()} safetyNet={null} />);
    pick(t("symptom.checkback.progress.same"));
    send();
    await waitFor(() => expect(screen.getByText(t("symptom.checkback.result.book"))).toBeTruthy());
    expect(screen.getByTestId("next-steps").textContent).toBe("routine");
  });

  it("the red-flag floor is re-run on this device: a ticked warning sign shows the emergency route BEFORE the server answers", async () => {
    let release: (v: unknown) => void = () => undefined;
    submit.mockReturnValue(new Promise((r) => (release = r)));
    render(<CheckbackForm view={view()} safetyNet={null} />);
    pick(t("symptom.checkback.progress.better"));
    fireEvent.click(screen.getByLabelText("confusion", { exact: false }));
    send();
    await waitFor(() => expect(screen.getByText(t("symptom.emergency.go_now"))).toBeTruthy());
    expect(screen.getByTestId("next-steps").textContent).toBe("emergency");
    release(outcome("emergency"));
  });

  it("an emergency already shown is never replaced by a server failure", async () => {
    submit.mockRejectedValue(new Error("network"));
    render(<CheckbackForm view={view()} safetyNet={null} />);
    pick(t("symptom.checkback.progress.better"));
    fireEvent.click(screen.getByLabelText("confusion", { exact: false }));
    send();
    await waitFor(() => expect(screen.getByText(t("symptom.emergency.go_now"))).toBeTruthy());
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(screen.getByText(t("symptom.emergency.go_now"))).toBeTruthy();
    expect(screen.queryByText(t("symptom.checkback.result.close"))).toBeNull();
  });

  it("a failed send says so and points to the safe routes, never to 'all clear'", async () => {
    submit.mockResolvedValue({ ok: false, reason: "failed" });
    render(<CheckbackForm view={view()} safetyNet={null} />);
    pick(t("symptom.checkback.progress.better"));
    send();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(t("symptom.checkback.error")));
    expect(screen.queryByText(t("symptom.checkback.result.close"))).toBeNull();
    expect(t("symptom.checkback.error")).toMatch(/nearest hospital/);
  });

  it("an answered follow-up shows its stored outcome; a cancelled or not-yet-open one says it is not waiting", () => {
    render(<CheckbackForm view={view({ state: "answered", outcome: { action: "keep_watching", progress: "same", escalated: false } })} safetyNet={null} />);
    expect(screen.getByText(t("symptom.checkback.result.keep_watching"))).toBeTruthy();
    cleanup();
    render(<CheckbackForm view={view({ state: "cancelled" })} safetyNet={null} />);
    expect(screen.getByText(t("symptom.checkback.gone"))).toBeTruthy();
  });

  it("can be skipped: answering is never required for anything", () => {
    render(<CheckbackForm view={view()} safetyNet={null} />);
    expect(screen.getByText(t("symptom.checkback.skip")).closest("a")?.getAttribute("href")).toBe("/patient/vitals#symptom-check");
  });
});
