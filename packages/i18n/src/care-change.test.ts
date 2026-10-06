import { describe, expect, it } from "@jest/globals";
import {
  buildChangeSentences,
  en,
  historyLine,
  outcomeMessageKey,
  parseCareChanges,
  parseConfirmOutcome,
  pcm,
  signedLine,
  splitCareChanges,
  t,
  type CareChange,
  type MessageKey,
} from "./index";

const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, "en", params);
const fmt = (iso: string) => iso.slice(0, 10);

const base: CareChange = {
  id: "c1",
  kind: "medication",
  state: "signed",
  summary: "Your reading has been high.",
  proposal: {},
  before: {},
  signedAt: "2026-10-06T10:00:00Z",
  expiresAt: "2026-10-13T10:00:00Z",
  signedByName: "Dr Ada Obi",
  confirmedAt: null,
  declinedAt: null,
};

describe("buildChangeSentences", () => {
  it("start: a new medicine, nothing to compare", () => {
    const s = buildChangeSentences(
      { ...base, proposal: { action: "start", item: { drug_name: "Amlodipine", dose: "5 mg", frequency: "once a day", route: "by mouth", duration_days: 30 } } },
      tr,
    );
    expect(s.heading).toBe(en["careChange.heading.start"]);
    expect(s.before).toBeNull();
    expect(s.after).toBe("Amlodipine, 5 mg, once a day, by mouth, for 30 days");
  });

  it("change: old versus new", () => {
    const s = buildChangeSentences(
      {
        ...base,
        proposal: { action: "change", medication_id: "m1", item: { drug_name: "Amlodipine", dose: "10 mg", frequency: "once a day" } },
        before: { medication_id: "m1", drug_name: "Amlodipine", dose: "5 mg", frequency: "once a day" },
      },
      tr,
    );
    expect(s.before).toBe("Amlodipine, 5 mg, once a day");
    expect(s.after).toBe("Amlodipine, 10 mg, once a day");
  });

  it("stop: names the one that stops", () => {
    const s = buildChangeSentences(
      { ...base, proposal: { action: "stop", medication_id: "m1" }, before: { drug_name: "Amlodipine", dose: "5 mg" } },
      tr,
    );
    expect(s.heading).toBe(en["careChange.heading.stop"]);
    expect(s.before).toBe("Amlodipine, 5 mg");
    expect(s.after).toBe(en["careChange.stopNow"]);
  });

  it("target: old and new numbers", () => {
    const s = buildChangeSentences(
      {
        ...base,
        kind: "target",
        proposal: { target_ranges: { blood_pressure: { min: 90, max: 130 } } },
        before: { target_ranges: { blood_pressure: "140 over 90" } },
      },
      tr,
    );
    expect(s.before).toBe("Blood pressure: 140 over 90");
    expect(s.after).toBe("Blood pressure: 90 to 130");
  });

  it("reading schedule: how often", () => {
    const s = buildChangeSentences(
      { ...base, kind: "reading_schedule", proposal: { reading_schedule: { times_per_week: 3 } }, before: { reading_schedule: {} } },
      tr,
    );
    expect(s.heading).toBe(en["careChange.heading.schedule"]);
    expect(s.before).toBe(en["careChange.nothingSet"]);
    expect(s.after).toBe("Times per week: 3");
  });

  it("degrades safely on missing or odd fields and never prints undefined or null", () => {
    const cases: CareChange[] = [
      { ...base, proposal: { action: "start" } },
      { ...base, proposal: { action: "change", item: { drug_name: null, dose: undefined } }, before: { drug_name: "undefined" } },
      { ...base, proposal: { action: "weird" } },
      { ...base, proposal: {} },
      { ...base, kind: "target", proposal: {}, before: {} },
      { ...base, kind: "reading_schedule", proposal: { reading_schedule: { a: null, b: [] } }, before: { reading_schedule: null } },
    ];
    for (const c of cases) {
      const s = buildChangeSentences(c, tr);
      const all = [s.heading, s.before ?? "", s.after ?? ""].join(" ");
      expect(all).not.toMatch(/undefined|null|\[object/);
      expect(s.heading.length).toBeGreaterThan(0);
    }
    expect(buildChangeSentences({ ...base, proposal: { action: "start" } }, tr).after).toBe(en["careChange.thisMedicine"]);
  });

  it("works in Pidgin too", () => {
    const trP = (key: MessageKey, params?: Record<string, string | number>) => t(key, "pcm", params);
    expect(buildChangeSentences({ ...base, proposal: { action: "stop" } }, trP).heading).toBe(pcm["careChange.heading.stop"]);
  });
});

describe("signedLine and historyLine", () => {
  it("prints the name and date when the name is known", () => {
    expect(signedLine(base, fmt, tr)).toBe("Signed by Dr Ada Obi on 2026-10-06");
  });
  it("never prints a null name", () => {
    const line = signedLine({ ...base, signedByName: null }, fmt, tr) ?? "";
    expect(line).toBe("Signed by your care team on 2026-10-06");
    expect(line).not.toMatch(/null|undefined/);
  });
  it("is null with no signed time", () => {
    expect(signedLine({ ...base, signedAt: null }, fmt, tr)).toBeNull();
  });
  it("history lines per state", () => {
    const p = { action: "start" };
    expect(historyLine({ ...base, state: "confirmed", proposal: p, confirmedAt: "2026-10-07T08:00:00Z" }, fmt, tr)).toContain("You said yes on 2026-10-07");
    expect(historyLine({ ...base, state: "declined", proposal: p, declinedAt: "2026-10-07T08:00:00Z" }, fmt, tr)).toContain("You said not now on 2026-10-07");
    expect(historyLine({ ...base, state: "expired", proposal: p }, fmt, tr)).toContain("timed out on 2026-10-13");
    expect(historyLine({ ...base, state: "confirmed", confirmedAt: null }, fmt, tr)).toBeNull();
  });
});

describe("parseCareChanges", () => {
  it("parses the RPC shape and drops bad rows", () => {
    const rows = parseCareChanges([
      { id: "a", kind: "medication", state: "signed", summary: "Why", proposal: { action: "stop" }, before: {}, signed_at: "x", expires_at: "y", signed_by_name: null },
      { id: "b", kind: "nonsense", state: "signed" },
      { kind: "medication", state: "signed" },
      "junk",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.signedByName).toBeNull();
    expect(rows[0]?.summary).toBe("Why");
  });
  it("handles null and non-arrays", () => {
    expect(parseCareChanges(null)).toEqual([]);
    expect(parseCareChanges({})).toEqual([]);
  });
  it("splits waiting from history", () => {
    const { waiting, history } = splitCareChanges([base, { ...base, id: "c2", state: "declined" }]);
    expect(waiting.map((c) => c.id)).toEqual(["c1"]);
    expect(history.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("outcomes", () => {
  it("parses outcomes and never treats junk as applied", () => {
    expect(parseConfirmOutcome({ outcome: "applied" })).toBe("applied");
    expect(parseConfirmOutcome({ outcome: "expired" })).toBe("expired");
    expect(parseConfirmOutcome({ outcome: "needs_review" })).toBe("needs_review");
    expect(parseConfirmOutcome({ outcome: "not_available" })).toBe("not_available");
    expect(parseConfirmOutcome({ outcome: "applied!" })).toBe("error");
    expect(parseConfirmOutcome(null)).toBe("error");
    expect(parseConfirmOutcome("applied")).toBe("error");
  });
  it("maps each outcome to plain words", () => {
    expect(t(outcomeMessageKey("applied", "medication"), "en")).toContain("download the new prescription");
    expect(t(outcomeMessageKey("applied", "medication", true), "en")).not.toContain("download");
    expect(outcomeMessageKey("applied", "target")).toBe("careChange.outcome.applied.plan");
    expect(t(outcomeMessageKey("expired", "medication"), "en")).toBe("This change timed out. Your care team will look at it again.");
    expect(outcomeMessageKey("needs_review", "medication")).toBe("careChange.outcome.needs_review");
    expect(outcomeMessageKey("not_available", "medication")).toBe("careChange.outcome.not_available");
    expect(outcomeMessageKey("error", "medication")).toBe("careChange.outcome.error");
  });
});

describe("careChange strings", () => {
  const FORBIDDEN = [/—/, /–/, /\bcures?\b/i, /\bcured\b/i, /instant doctor/i, /free healthcare/i, /your doctor/i];
  it("no em dash or forbidden word in any en or pcm careChange string", () => {
    for (const [locale, table] of [["en", en], ["pcm", pcm]] as const) {
      for (const [key, value] of Object.entries(table)) {
        if (!key.startsWith("careChange.")) continue;
        for (const re of FORBIDDEN) expect([locale, key, re.test(value)]).toEqual([locale, key, false]);
      }
    }
  });
  it("the two answer buttons read as equals and say nothing changes until yes", () => {
    expect(en["careChange.yes"]).toBe("Yes, make this change");
    expect(en["careChange.no"]).toBe("Not now, I want to talk first");
    expect(en["careChange.promise"]).toMatch(/Nothing changes until you say yes/);
  });
});
