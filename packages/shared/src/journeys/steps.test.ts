import { describe, expect, it } from "@jest/globals";
import { JourneyRun, isValidOwner, renderReport, renderSummary, verdictOf } from "./steps";

const decl = [
  { id: "a", title: "first" },
  { id: "b", title: "second" },
  { id: "c", title: "third" },
];

describe("JourneyRun", () => {
  it("is passing only when every step passed", async () => {
    const run = new JourneyRun("J", "t", decl);
    for (const s of decl) await run.step(s.id, () => {});
    const r = run.report();
    expect(r.verdict).toBe("passing");
    expect(r.counts).toEqual({ passed: 3, failed: 0, pending: 0, skipped: 0, total: 3 });
  });

  it("is INCOMPLETE, never passing, while any step is pending, and counts the pending steps by owner", async () => {
    const run = new JourneyRun("J", "t", decl);
    await run.step("a", () => {});
    run.pending("b", "S58", "Health Points are not built");
    run.pending("c", "S79", "institution console is not built");
    const r = run.report();
    expect(r.verdict).toBe("incomplete");
    expect(r.counts.pending).toBe(2);
    expect(r.pendingByOwner).toEqual({ S58: ["b"], S79: ["c"] });
    expect(renderReport(r)).toContain("INCOMPLETE");
    expect(renderReport(r)).not.toMatch(/verdict: PASSING/);
  });

  it("a skipped step also keeps the journey incomplete", async () => {
    const run = new JourneyRun("J", "t", decl);
    await run.step("a", () => {});
    await run.step("b", () => {});
    run.skipped("c", "no Paystack test key in this environment");
    expect(run.report().verdict).toBe("incomplete");
  });

  it("records a throw as a failure, keeps going, and failed outranks pending", async () => {
    const run = new JourneyRun("J", "t", decl);
    const ok = await run.step("a", () => {
      throw new Error("boom");
    });
    expect(ok).toBe(false);
    run.pending("b", "S59", "symptom checker is not built");
    await run.step("c", async () => {});
    const r = run.report();
    expect(r.verdict).toBe("failed");
    expect(r.steps[0]?.result).toEqual({ status: "failed", reason: "boom" });
  });

  it("treats a step nobody resolved as a failure (no step can silently vanish)", async () => {
    const run = new JourneyRun("J", "t", decl);
    await run.step("a", () => {});
    const r = run.report();
    expect(r.verdict).toBe("failed");
    expect(r.counts.failed).toBe(2);
  });

  it("refuses an empty journey, duplicate ids, bad ids, unknown steps and double resolution", async () => {
    expect(() => new JourneyRun("J", "t", [])).toThrow(/no steps/);
    expect(() => new JourneyRun("J", "t", [decl[0]!, decl[0]!])).toThrow(/duplicate/);
    expect(() => new JourneyRun("J", "t", [{ id: "Bad Id", title: "x" }])).toThrow(/bad step id/);
    const run = new JourneyRun("J", "t", decl);
    expect(() => run.pending("zzz", "S58", "reason here")).toThrow(/unknown step/);
    run.pending("a", "S58", "reason here");
    expect(() => run.pending("a", "S58", "reason here")).toThrow(/already resolved/);
  });

  it("a pending step must name an owner session (or CMO / FOUNDER) and a reason", () => {
    const run = new JourneyRun("J", "t", decl);
    expect(() => run.pending("a", "", "a reason")).toThrow(/owner/);
    expect(() => run.pending("a", "someone", "a reason")).toThrow(/owner/);
    expect(() => run.pending("a", "S58", "no")).toThrow(/reason/);
    expect(isValidOwner("S58")).toBe(true);
    expect(isValidOwner("S59, S60")).toBe(true);
    expect(isValidOwner("S59a")).toBe(true);
    expect(isValidOwner("CMO approves the rule set")).toBe(true);
    expect(isValidOwner("S5")).toBe(false);
  });

  it("verdictOf never returns passing with pending or skipped steps (property over small counts)", () => {
    for (let p = 0; p < 3; p++)
      for (let s = 0; s < 3; s++)
        for (let f = 0; f < 3; f++) {
          const v = verdictOf({ passed: 2, failed: f, pending: p, skipped: s });
          if (p + s + f > 0) expect(v).not.toBe("passing");
        }
  });

  it("the summary adds pending steps across journeys and never says a stage is complete", async () => {
    const a = new JourneyRun("J1", "one", decl);
    a.pending("a", "S58", "reason here");
    a.pending("b", "S58", "reason here");
    a.pending("c", "S58", "reason here");
    const b = new JourneyRun("J2", "two", decl);
    for (const s of decl) await b.step(s.id, () => {});
    const text = renderSummary([a.report(), b.report()]);
    expect(text).toContain("pending 3");
    expect(text).not.toMatch(/stage 1|\bgate\b|\bcomplete\b/i);
    expect(text).not.toMatch(/\bpassing\b.*J1/);
  });
});
