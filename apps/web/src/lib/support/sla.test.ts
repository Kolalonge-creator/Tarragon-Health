import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { describeClock, formatMinutes, isBreached, sortByClock, ticketClock, type SlaTargets, type TicketClockInput } from "./sla";

const targets = getProposedConfig<SlaTargets>("support.sla_targets").value;
const T0 = new Date("2026-10-27T09:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const base: TicketClockInput = {
  created_at: T0.toISOString(),
  first_response_at: null,
  resolved_at: null,
  status: "new",
  priority: "normal",
  is_clinical: false,
};

describe("support ticket clock (targets come from the PROPOSED config, never from this file)", () => {
  it("takes its numbers from support.sla_targets", () => {
    expect(targets.first_response_minutes.normal).toBeGreaterThan(0);
    const c = ticketClock(base, T0, targets);
    expect(Date.parse(c.firstResponse.dueAt) - T0.getTime()).toBe(targets.first_response_minutes.normal * 60_000);
    expect(Date.parse(c.resolution.dueAt) - T0.getTime()).toBe(targets.resolution_hours.normal * 3_600_000);
  });

  it("is ok early, due soon after the warn fraction, breached after the target", () => {
    const n = targets.first_response_minutes.normal;
    expect(ticketClock(base, at(1), targets).firstResponse.state).toBe("ok");
    expect(ticketClock(base, at(Math.ceil(n * targets.warn_fraction) + 1), targets).firstResponse.state).toBe("due_soon");
    const late = ticketClock(base, at(n + 5), targets);
    expect(late.firstResponse.state).toBe("breached");
    expect(isBreached(late)).toBe(true);
    expect(late.worst).toBe("breached");
  });

  it("a clinical ticket uses the shorter first-reply target", () => {
    const high = { ...base, priority: "low" as const, is_clinical: true };
    const c = ticketClock(high, T0, targets);
    expect(Date.parse(c.firstResponse.dueAt) - T0.getTime()).toBe(targets.clinical_first_response_minutes * 60_000);
    const plain = ticketClock({ ...high, is_clinical: false }, T0, targets);
    expect(Date.parse(plain.firstResponse.dueAt)).toBeGreaterThan(Date.parse(c.firstResponse.dueAt));
  });

  it("a reply within the target is met, after it is late, and a late reply is never shown as breached again", () => {
    const n = targets.first_response_minutes.normal;
    const met = ticketClock({ ...base, first_response_at: at(10).toISOString() }, at(n + 100), targets);
    expect(met.firstResponse.state).toBe("met");
    const late = ticketClock({ ...base, first_response_at: at(n + 10).toISOString() }, at(n + 100), targets);
    expect(late.firstResponse.state).toBe("late");
    expect(isBreached(late)).toBe(false);
  });

  it("waiting on the patient pauses the resolution clock instead of breaching it", () => {
    const hours = targets.resolution_hours.normal;
    const c = ticketClock({ ...base, status: "awaiting_patient", first_response_at: at(5).toISOString() }, at(hours * 60 + 600), targets);
    expect(c.resolution.state).toBe("paused");
    expect(isBreached(c)).toBe(false);
  });

  it("a resolved ticket is met or late by when it was resolved", () => {
    const hours = targets.resolution_hours.normal;
    const ok = ticketClock({ ...base, status: "resolved", first_response_at: at(5).toISOString(), resolved_at: at(60).toISOString() }, at(hours * 60 * 3), targets);
    expect(ok.resolution.state).toBe("met");
    const late = ticketClock({ ...base, status: "closed", first_response_at: at(5).toISOString(), resolved_at: at(hours * 60 + 1).toISOString() }, at(hours * 60 * 3), targets);
    expect(late.resolution.state).toBe("late");
  });

  it("describes the worst open part in plain words", () => {
    const n = targets.first_response_minutes.normal;
    expect(describeClock(ticketClock(base, at(n + 120), targets))).toMatch(/First reply .* overdue/);
    expect(describeClock(ticketClock({ ...base, status: "awaiting_patient", first_response_at: at(1).toISOString() }, at(10), targets))).toBe("Waiting on the patient");
    expect(describeClock(ticketClock({ ...base, first_response_at: at(1).toISOString() }, at(10), targets))).toBe("Resolution due in " + formatMinutes(targets.resolution_hours.normal * 60 - 10));
    expect(formatMinutes(30)).toBe("30 min");
    expect(formatMinutes(180)).toBe("3 h");
    expect(formatMinutes(60 * 24 * 5)).toBe("5 days");
  });

  it("sorts past-target tickets first, then oldest first, without losing any", () => {
    const rows = [
      { id: "a", ...base, created_at: at(0).toISOString() },
      { id: "b", ...base, priority: "critical" as const, created_at: at(10).toISOString() },
      { id: "c", ...base, created_at: at(-10).toISOString() },
    ];
    const now = at(targets.first_response_minutes.critical + 60);
    const sorted = sortByClock(rows, (r) => ticketClock(r, now, targets));
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sorted).toHaveLength(3);
  });
});
