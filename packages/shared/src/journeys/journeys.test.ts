import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { J1, J2, J3, J4, JOURNEYS, knownPendingCount, startJourney } from "./journeys";
import { renderReport, renderSummary } from "./steps";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const INDEX = readFileSync(join(ROOT, "docs", "v5-sessions", "00-INDEX.md"), "utf8");

describe("journey definitions", () => {
  it("every known-pending step names an owner session that exists in the v5 session index", () => {
    for (const def of Object.values(JOURNEYS)) {
      for (const s of def.steps) {
        if (!s.pending) continue;
        for (const id of s.pending.owner.match(/S\d{2}[a-z]?/g) ?? []) {
          const base = id.slice(0, 3);
          expect({ journey: def.id, step: s.id, owner: id, indexed: INDEX.includes(`[${base}]`) }).toMatchObject({ indexed: true });
        }
      }
    }
  });

  it("step ids are unique within each journey and every step has a title", () => {
    for (const def of Object.values(JOURNEYS)) {
      expect(new Set(def.steps.map((s) => s.id)).size).toBe(def.steps.length);
      for (const s of def.steps) expect(s.title.length).toBeGreaterThan(10);
    }
  });

  it("the four D.7.3 journeys are all declared", () => {
    expect(Object.keys(JOURNEYS).sort()).toEqual(["J1", "J2", "J3", "J4"]);
  });

  it("known-pending counts per journey (a change here is a deliberate edit to what the platform lacks)", () => {
    expect({ J1: knownPendingCount(J1), J2: knownPendingCount(J2), J3: knownPendingCount(J3), J4: knownPendingCount(J4) }).toEqual({
      J1: 6,
      J2: 2,
      J3: 12,
      J4: 2,
    });
  });
});

describe("Journey 3 typed skeleton", () => {
  it("every step is pending with an owner, so the journey is INCOMPLETE and never passing", () => {
    const run = startJourney(J3);
    const r = run.report();
    expect(r.counts).toEqual({ passed: 0, failed: 0, pending: J3.steps.length, skipped: 0, total: J3.steps.length });
    expect(r.verdict).toBe("incomplete");
    expect(Object.keys(r.pendingByOwner).sort()).toEqual(["CMO signs a urinary pathway", "FOUNDER decides whether causes are ever shown", "S51", "S53", "S54", "S59", "S60", "S64"]);
    expect(renderReport(r)).toContain("INCOMPLETE");
  });

  it("a later session turns a step on by deleting its pending entry; running a still-pending step is refused", async () => {
    const run = startJourney(J3);
    await expect(run.step("symptom-checker-opens", () => {})).rejects.toThrow(/already resolved/);
  });
});

describe("the four journeys together", () => {
  it("a freshly started journey reports its known-pending steps and is never passing", () => {
    const reports = [J1, J2, J3, J4].map((d) => startJourney(d).report());
    for (const r of reports) expect(r.verdict).not.toBe("passing");
    const text = renderSummary(reports);
    expect(text).toContain("Journeys: 4");
    // nothing in the wording claims a stage or a gate is done
    expect(text).not.toMatch(/stage 1|\bgate\b|\bcomplete\b/i);
  });
});

describe("S85b: the web offline guidance step is a real assertion, not a pending entry", () => {
  const spec = readFileSync(join(ROOT, "apps", "web", "e2e-browser", "journeys", "journey-2-red-reading-at-night.spec.ts"), "utf8");
  const present = (text: string): boolean =>
    text.includes('run.step("guidance-with-network-off-web"') &&
    text.includes("context.setOffline(true)") &&
    text.includes('activeWording("EMG-001")') &&
    /graded\?\.grade === "red"/.test(text);

  it("the definition no longer carries a pending entry for it and the spec runs it with the network off", () => {
    expect(J2.steps.find((s) => s.id === "guidance-with-network-off-web")?.pending).toBeUndefined();
    expect(present(spec)).toBe(true);
  });

  it("sabotage: take the offline switch, the wording check or the never-weaker comparison out of the spec and the check notices", () => {
    expect(present(spec.replace("context.setOffline(true)", "/* online */"))).toBe(false);
    expect(present(spec.replace('activeWording("EMG-001")', "null"))).toBe(false);
    expect(present(spec.replaceAll('graded?.grade === "red"', "false"))).toBe(false);
    expect(present(spec.replace('run.step("guidance-with-network-off-web"', 'run.pending("guidance-with-network-off-web"'))).toBe(false);
  });

  it("the stale Pidgin audio wording is gone from journey 1 (D-14, English only)", () => {
    const step = J1.steps.find((s) => s.id === "result-plain-language-explanation")!;
    expect(step.title).toMatch(/English/);
    expect(step.title).not.toMatch(/audio in English; Pidgin was removed/);
  });
});
