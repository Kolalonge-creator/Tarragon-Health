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
      J1: 5,
      J2: 1,
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
  // The step must exercise three SEPARATE paths with the network off (a symptom alone, a reading alone with the tick cleared, both together) and judge
  // them against the rule set row and the stored server grade. Each marker below is one piece of that; taking any out must be noticed.
  const markers: Array<[string, (t: string) => boolean]> = [
    ["the step is run, not marked pending", (t) => t.includes('run.step("guidance-with-network-off-web"')],
    ["the network is really switched off", (t) => t.includes("context.setOffline(true)")],
    ["the signed wording is checked", (t) => t.includes('activeWording("EMG-001")')],
    ["the symptom-only path is captured", (t) => t.includes("offlineWeb.symptomOnly = true")],
    ["the tick is cleared before the reading-only path", (t) => /await tick\.uncheck\(\);[\s\S]{0,200}not\.toBeChecked\(\)[\s\S]{0,400}offlineWeb\.readingOnly = /.test(t)],
    ["the reading-only path is judged by the engine on the reading without the symptom, asked and unasked", (t) => /symptoms: \[\], symptomsAnswered: answered/.test(t) && t.includes('"symptom_check_required"') && t.includes("if (readingNeedsGuidance) expect(offlineWeb.readingOnly")],
    ["the combined path is compared with the stored server grade", (t) => /graded!\.grade === "red"\) expect\(offlineWeb\.combined/.test(t)],
    ["the question line and symptom group come from the database rule set", (t) => t.includes("rules.params.symptomGroups.redFlag") && t.includes('rpc("triage_rule_set_for_grading"')],
  ];

  it("the definition no longer carries a pending entry for it and the spec runs it with the network off", () => {
    expect(J2.steps.find((s) => s.id === "guidance-with-network-off-web")?.pending).toBeUndefined();
    for (const [name, check] of markers) expect({ name, present: check(spec) }).toEqual({ name, present: true });
  });

  it("sabotage: take any one piece out of the spec and the scan notices", () => {
    const damaged: Array<[string, string]> = [
      ["the network is really switched off", spec.replace("context.setOffline(true)", "/* online */")],
      ["the signed wording is checked", spec.replace('activeWording("EMG-001")', "null")],
      ["the symptom-only path is captured", spec.replace("offlineWeb.symptomOnly = true", "")],
      ["the tick is cleared before the reading-only path", spec.replace("await tick.uncheck();", "")],
      ["the reading-only path is judged by the engine on the reading without the symptom, asked and unasked", spec.replace("if (readingNeedsGuidance) expect(offlineWeb.readingOnly", "if (false) expect(offlineWeb.readingOnly")],
      ["the combined path is compared with the stored server grade", spec.replaceAll('graded!.grade === "red"', "false")],
      ["the question line and symptom group come from the database rule set", spec.replace("rules.params.symptomGroups.redFlag", "[]")],
      ["the step is run, not marked pending", spec.replace('run.step("guidance-with-network-off-web"', 'run.pending("guidance-with-network-off-web"')],
    ];
    for (const [name, text] of damaged) {
      const check = markers.find(([n]) => n === name)![1];
      expect({ name, caught: check(text) === false }).toEqual({ name, caught: true });
    }
  });

  it("the stale Pidgin audio wording is gone from journey 1 (D-14, English only)", () => {
    const step = J1.steps.find((s) => s.id === "result-plain-language-explanation")!;
    expect(step.title).toMatch(/English/);
    expect(step.title).not.toMatch(/audio in English; Pidgin was removed/);
  });
});

describe("S85b review: a step is only enabled when its assertion measures the spec's own wording", () => {
  const j1 = readFileSync(join(ROOT, "apps", "web", "e2e-browser", "journeys", "journey-1-first-month.spec.ts"), "utf8");

  it("the goal, Health Points and result explanation steps carry the founder's 2026-10-28 wording and are no longer pending", () => {
    for (const id of ["goal-blood-pressure", "health-points-awarded", "result-plain-language-explanation"]) {
      const step = J1.steps.find((s) => s.id === id)!;
      expect({ id, ok: /founder decision 2026-10-28/.test(step.title) }).toEqual({ id, ok: true });
      expect({ id, pending: step.pending }).toEqual({ id, pending: undefined });
    }
  });

  const runsAsStep = (text: string, id: string) => text.includes(`run.step("${id}"`) && !text.includes("supporting check:");

  it("the spec runs each of them as a journey step, not a supporting check", () => {
    for (const id of ["goal-blood-pressure", "health-points-awarded", "result-plain-language-explanation"]) {
      expect({ id, runs: runsAsStep(j1, id) }).toEqual({ id, runs: true });
    }
  });

  it("sabotage: the same scan fails when a step is turned back into a supporting check, or dropped", () => {
    const backToSupporting = j1.replace('run.step("goal-blood-pressure"', 'test.step("supporting check: goal"');
    expect(runsAsStep(backToSupporting, "goal-blood-pressure")).toBe(false);
    const dropped = j1.replace('run.step("result-plain-language-explanation"', 'run.step("something-else"');
    expect(runsAsStep(dropped, "result-plain-language-explanation")).toBe(false);
  });
});
