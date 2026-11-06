import { describe, expect, it } from "@jest/globals";
import { parseCareCircle, parseOnboarding } from "./onboarding-and-circle-audited";

describe("parseOnboarding", () => {
  it("keeps known codes and the latest answer date", () => {
    const out = parseOnboarding({
      status: "ok",
      answers: [
        { question_code: "conditions", answer: ["hypertension", "made_up"], answered_at: "2026-10-01T00:00:00Z" },
        { question_code: "goals", answer: ["stay_ahead"], answered_at: "2026-10-02T00:00:00Z" },
      ],
    });
    expect(out).toEqual({ status: "ok", value: { goals: ["stay_ahead"], conditions: ["hypertension"], answeredAt: "2026-10-02T00:00:00Z" } });
  });
  it("a refusal is denied and a bad shape is an error, never an empty answer", () => {
    expect(parseOnboarding({ status: "denied" })).toEqual({ status: "denied" });
    expect(parseOnboarding({ status: "ok" })).toEqual({ status: "error" });
    expect(parseOnboarding(null)).toEqual({ status: "error" });
  });
});

describe("parseCareCircle", () => {
  it("reads supporters, drops unknown permissions, and keeps the pause", () => {
    const out = parseCareCircle({
      status: "ok",
      pause: { paused_until: "2026-11-10T00:00:00Z", pause_alerts: false },
      supporters: [
        { supporter_name: "Ngozi", relationship: "Daughter", permissions: ["appointments", "new_thing"], contact_role: "primary", since: "2026-10-01T00:00:00Z", expires_at: null },
      ],
    });
    expect(out).toEqual({
      status: "ok",
      value: {
        pause: { until: "2026-11-10T00:00:00Z", alertsPaused: false },
        supporters: [{ name: "Ngozi", relationship: "Daughter", permissions: ["appointments"], primaryContact: true, since: "2026-10-01T00:00:00Z" }],
      },
    });
  });
  it("a refusal is denied and a bad shape is an error", () => {
    expect(parseCareCircle({ status: "denied" })).toEqual({ status: "denied" });
    expect(parseCareCircle({ status: "ok", supporters: "x" })).toEqual({ status: "error" });
  });
});
