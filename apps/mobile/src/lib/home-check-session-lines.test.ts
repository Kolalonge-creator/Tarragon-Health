import { en, t, type MessageKey } from "@tarragon/i18n";
import type { SessionStep } from "@tarragon/clinical";
import { sessionLine } from "./home-check-session-lines";

const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, "en", params);

describe("sessionLine", () => {
  it("says each step in words, with the numbers filled in", () => {
    const steps: [SessionStep, RegExp][] = [
      [{ kind: "outside_window", next: "morning" }, /next session is in the morning, when you wake up/i],
      [{ kind: "outside_window", next: "evening" }, /evening.*before bed/i],
      [{ kind: "rest", part: "morning", number: 1, of: 2, restMinutes: 5 }, /Sit quietly for 5 minutes.*reading 1 of 2.*form below/i],
      [{ kind: "wait", part: "morning", number: 2, of: 2, secondsLeft: 40 }, /Wait 40 seconds, then take reading 2 of 2/],
      [{ kind: "next", part: "evening", number: 2, of: 2 }, /Take reading 2 of 2 now/],
      [{ kind: "done", part: "morning", readings: 2, mean: { systolic: 136, diastolic: 87 } }, /The 2 readings average 136 over 87.*appears when you have enough readings/],
    ];
    for (const [step, re] of steps) expect(sessionLine(step, tr)).toMatch(re);
  });

  it("once the overall check is complete, the done line does not say the average is still to come", () => {
    const done: SessionStep = { kind: "done", part: "morning", readings: 2, mean: { systolic: 136, diastolic: 87 } };
    const line = sessionLine(done, tr, { overallComplete: true });
    expect(line).toBe("This session is done. The 2 readings average 136 over 87.");
    expect(line).not.toMatch(/appears when/);
  });

  it("while guidance for the reading just saved is on screen, every step gives way to one line (it never says wait or carry on)", () => {
    const steps: SessionStep[] = [
      { kind: "outside_window", next: "morning" },
      { kind: "rest", part: "morning", number: 1, of: 2, restMinutes: 5 },
      { kind: "wait", part: "morning", number: 2, of: 2, secondsLeft: 40 },
      { kind: "next", part: "evening", number: 2, of: 2 },
      { kind: "done", part: "morning", readings: 2, mean: { systolic: 136, diastolic: 87 } },
    ];
    for (const step of steps) {
      const line = sessionLine(step, tr, { hold: true });
      expect(line).toMatch(/Look after yourself first\. Follow the guidance on this screen/);
      expect(line).not.toMatch(/\bwait\b|take reading|Sit quietly/i);
    }
  });

  it("never grades, never calls the average good or bad, never claims a person has seen it, never promises a time, never gives a medicine instruction", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("hc.session.")) as MessageKey[];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      const text = String(en[k]);
      expect(text).not.toMatch(/\b(controlled|uncontrolled|high|low|normal|dangerous|reviewed|doctor|care team|soon|shortly|medicines?|tablets?)\b/i);
      expect(text).not.toMatch(/—|–/);
    }
  });
});
