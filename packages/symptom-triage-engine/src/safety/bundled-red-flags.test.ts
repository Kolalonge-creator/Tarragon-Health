/**
 * The on-device floor (INV-06). It must (a) be a faithful copy of the signed rules, (b) work with no I/O at all, and
 * (c) in degraded mode fire on a superset of what the signed rules fire on.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { screenRedFlags } from "../engine/index";
import { parseTriageProtocolConfig, type SymptomCapture } from "../types/index";
import { BUNDLED_RED_FLAG_RULES, evaluateBundledRedFlags } from "./bundled-red-flags";

const fixture: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("../protocols/db-seed-fixture.json", import.meta.url)), "utf-8"));

const cap = (p: Partial<SymptomCapture> & Pick<SymptomCapture, "presentingComplaintKey">): SymptomCapture => ({
  onset: "gradual",
  severity: 3,
  associatedSymptoms: [],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...p,
});

describe("bundled red-flag content", () => {
  it("is exactly the red-flag rules of the signed database seed (no drift between the copy and the protocol)", () => {
    const db = parseTriageProtocolConfig(fixture);
    expect(db).not.toBeNull();
    const fromDb = db!.pathways.flatMap((p) => p.redFlagScreen.map((r) => ({ pathwayKey: p.key, ...r })));
    expect(BUNDLED_RED_FLAG_RULES.map((r) => ({ ...r }))).toEqual(fromDb);
  });

  it("is frozen: nothing can edit the floor at runtime", () => {
    expect(Object.isFrozen(BUNDLED_RED_FLAG_RULES)).toBe(true);
    expect(() => {
      (BUNDLED_RED_FLAG_RULES as unknown as unknown[]).push({});
    }).toThrow();
  });

  it("fires the same flags as the engine's own screen when run as signed", () => {
    const db = parseTriageProtocolConfig(fixture)!;
    for (const p of db.pathways) {
      for (const sx of [[], ["sweating"], ["breathlessness"], ["fainting"], ["neck_stiffness", "fever"], ["chest_pain"]]) {
        for (const severity of [1, 5, 6, 8, 10]) {
          const c = cap({ presentingComplaintKey: p.key, severity, associatedSymptoms: sx, onset: severity >= 8 ? "sudden" : "gradual" });
          const own = screenRedFlags(c, p.redFlagScreen);
          const bundled = evaluateBundledRedFlags(c);
          expect(bundled.fired.map((f) => f.key)).toEqual(own.fired.map((f) => f.key));
        }
      }
    }
  });

  it("degraded mode (severity floors ignored) fires on a superset of the signed rules", () => {
    for (const p of ["headache", "chest_pain", "breathlessness"]) {
      for (const sx of [[], ["sweating"], ["breathlessness"], ["fainting"], ["weakness_or_numbness"], ["chest_pain"], ["vision_loss"]]) {
        for (const severity of [1, 3, 5, 6, 8]) {
          const c = cap({ presentingComplaintKey: p, severity, associatedSymptoms: sx });
          const strict = new Set(evaluateBundledRedFlags(c).fired.map((f) => f.key));
          const relaxed = new Set(evaluateBundledRedFlags(c, { ignoreSeverityFloors: true }).fired.map((f) => f.key));
          for (const k of strict) expect(relaxed.has(k)).toBe(true);
        }
      }
    }
  });

  it("chest pain with sweating at low severity does not fire as signed (a CMO question) but does when degraded", () => {
    const c = cap({ presentingComplaintKey: "chest_pain", severity: 3, associatedSymptoms: ["sweating"] });
    expect(evaluateBundledRedFlags(c).hasFlag).toBe(false);
    expect(evaluateBundledRedFlags(c, { ignoreSeverityFloors: true }).topCategory).toBe("emergency");
  });

  it("an unknown complaint tries every rule, a broken rule is reported and never hides the others", () => {
    const c = cap({ presentingComplaintKey: "never_heard_of_it", associatedSymptoms: ["fainting"] });
    expect(evaluateBundledRedFlags(c).topCategory).toBe("emergency");
    const throwing = [{ key: "x.bad", label: "bad", category: "emergency" as const, pathwayKey: "chest_pain", rule: { get anyAssociatedSymptom(): string[] { throw new Error("bad"); } } }];
    const r = evaluateBundledRedFlags(cap({ presentingComplaintKey: "chest_pain" }), { rules: throwing });
    expect(r.brokenRules).toEqual(["x.bad"]);
    expect(r.hasFlag).toBe(false);
  });
});
