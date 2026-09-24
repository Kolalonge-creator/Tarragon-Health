/** @jest-environment jsdom */
/**
 * VitalsForm's pre-submit offline guard is the client-side half of the
 * network-resilience fix. An earlier version of this fix wrapped the
 * imported `logVital` in a local try/catch and passed THAT wrapper to
 * useActionState — that broke this form's no-JS/pre-hydration submission
 * fallback (confirmed live: React emits a poison-pill
 * `action="javascript:throw new Error(...)"` for a form whose action isn't
 * a genuine Server Reference). This guard instead blocks a submission
 * BEFORE it reaches `formAction` when the browser already knows it's
 * offline, so `logVital` itself stays wired to useActionState unwrapped —
 * see docs/OFFLINE_RESILIENCE_AUDIT.md §3/§6 for the full account. This
 * proves: (1) a blocked submission never calls the action and shows the
 * offline message instead, (2) a normal online submission is unaffected,
 * and (3) `useActionState` is still wired to `logVital` directly, not a
 * wrapper — a live-browser check (not reproducible here) is what actually
 * caught the regression this guards against: React emits a poison-pill DOM
 * `action="javascript:throw ..."` for a form whose action isn't a genuine
 * Server Reference, but jest.mock("./actions", ...) strips that special
 * "use server" marking from `logVital` regardless of whether vitals-form.tsx
 * wraps it, so the DOM attribute looks identical (already a poison pill)
 * either way under Jest — confirmed by trying exactly that assertion here
 * and finding it can't distinguish the two cases. A source-level check on
 * the actual `useActionState(...)` call is what CAN catch this at the unit
 * level; a live browser pass (see docs/OFFLINE_RESILIENCE_AUDIT.md §5/§6)
 * remains the only way to prove progressive enhancement itself still works.
 */
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { VitalsForm } from "./vitals-form";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockLogVital = jest.fn(async () => undefined);
jest.mock("./actions", () => ({
  logVital: () => mockLogVital(),
}));

let mockIsOnline = true;
jest.mock("@/lib/network/use-online-status", () => ({
  useOnlineStatus: () => mockIsOnline,
}));

function fillBloodPressure() {
  fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: "120" } });
  fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: "80" } });
}

describe("VitalsForm offline guard", () => {
  beforeEach(() => {
    mockLogVital.mockClear();
    mockIsOnline = true;
  });

  it("blocks submission and shows the offline message when the browser reports offline", () => {
    mockIsOnline = false;
    render(<VitalsForm patientId="patient-1" />);
    fillBloodPressure();

    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));

    expect(mockLogVital).not.toHaveBeenCalled();
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
  });

  it("submits normally when the browser reports online", () => {
    mockIsOnline = true;
    render(<VitalsForm patientId="patient-1" />);
    fillBloodPressure();

    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));

    expect(mockLogVital).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/you're offline/i)).toBeNull();
  });

  it("passes logVital directly to useActionState, not a wrapper (progressive enhancement)", () => {
    // A DOM-attribute assertion can't distinguish this under Jest (see the
    // file's top comment) — this is a source-level contract test instead.
    // If this ever needs to change, re-verify live in the browser first
    // (raw <form> action attribute, not just that the guard's own behavior
    // still passes) before updating this assertion.
    const source = fs.readFileSync(path.join(__dirname, "vitals-form.tsx"), "utf8");
    expect(source).toMatch(/useActionState\(\s*logVital\s*,/);
  });
});
