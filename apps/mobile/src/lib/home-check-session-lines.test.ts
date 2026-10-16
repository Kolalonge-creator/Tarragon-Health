import { en, t, type MessageKey } from "@tarragon/i18n";
import type { SessionStep } from "@tarragon/clinical";
import { sessionLine } from "./home-check-session-lines";

const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, "en", params);

describe("sessionLine", () => {
  it("says each step in words, with the numbers filled in", () => {
    const steps: [SessionStep, RegExp][] = [
      [{ kind: "outside_window", next: "morning" }, /morning.*before you take your medicines/i],
      [{ kind: "outside_window", next: "evening" }, /evening.*before bed/i],
      [{ kind: "rest", part: "morning", number: 1, of: 2, restMinutes: 5 }, /Sit quietly for 5 minutes.*before you take your medicines.*reading 1 of 2/i],
      [{ kind: "wait", part: "morning", number: 2, of: 2, secondsLeft: 40 }, /Wait 40 seconds, then take reading 2 of 2/],
      [{ kind: "next", part: "evening", number: 2, of: 2 }, /Take reading 2 of 2 now/],
      [{ kind: "done", part: "morning", readings: 2, mean: { systolic: 136, diastolic: 87 } }, /The 2 readings average 136 over 87/],
    ];
    for (const [step, re] of steps) expect(sessionLine(step, tr)).toMatch(re);
  });

  it("never grades, never calls the average good or bad, never claims a person has seen it, never promises a time", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("hc.session.")) as MessageKey[];
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) {
      const text = String(en[k]);
      expect(text).not.toMatch(/\b(controlled|uncontrolled|high|low|normal|dangerous|reviewed|doctor|care team|soon|shortly)\b/i);
      expect(text).not.toMatch(/—|–/);
    }
  });
});
