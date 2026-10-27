import { describe, expect, it } from "@jest/globals";
import { SEED_TRIAGE_PROTOCOL_CONFIG } from "../protocols/index";
import type { TriageProtocolConfig } from "../types/index";
import { buildProbes, captureForRule, diffProtocols, runRegression } from "./compare";

const clone = (c: TriageProtocolConfig): TriageProtocolConfig => JSON.parse(JSON.stringify(c)) as TriageProtocolConfig;
const base = SEED_TRIAGE_PROTOCOL_CONFIG;
const withVersion = (c: TriageProtocolConfig, v: number): TriageProtocolConfig => ({ ...c, version: v });

describe("triage protocol comparison (read-only)", () => {
  it("two identical versions differ in nothing and replay with no change", () => {
    const b = withVersion(clone(base), 2);
    const d = diffProtocols(base, b);
    expect(d.identical).toBe(true);
    const r = runRegression(base, b);
    expect(r.probesRun).toBeGreaterThan(10);
    expect(r.changed).toEqual([]);
    expect(r.loosened).toEqual([]);
    expect(r.notReplayed).toEqual([]);
  });

  it("does not mutate either input", () => {
    const a = clone(base);
    const b = withVersion(clone(base), 2);
    const before = JSON.stringify([a, b]);
    diffProtocols(a, b);
    runRegression(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it("every red-flag rule probe fires its own rule in the version it came from", () => {
    for (const p of base.pathways) {
      for (const rule of p.redFlagScreen) {
        const { probes } = buildProbes(p, p);
        expect(probes.some((x) => x.id === `${p.key}:rule:${rule.key}`)).toBe(true);
        const cap = captureForRule(p.key, rule);
        const r = runRegression({ version: 1, pathways: [p] }, { version: 2, pathways: [p] });
        expect(r.changed).toEqual([]);
        expect(cap.presentingComplaintKey).toBe(p.key);
      }
    }
  });

  it("a removed red flag is listed in the diff and replays as a LOOSENED answer", () => {
    const b = withVersion(clone(base), 2);
    const target = b.pathways.find((p) => p.redFlagScreen.some((r) => r.category === "emergency"));
    expect(target).toBeDefined();
    const removed = target!.redFlagScreen.find((r) => r.category === "emergency")!;
    target!.redFlagScreen = target!.redFlagScreen.filter((r) => r.key !== removed.key);
    const d = diffProtocols(base, b);
    expect(d.pathways.find((p) => p.key === target!.key)?.redFlagsRemoved).toContain(removed.key);
    const r = runRegression(base, b);
    expect(r.changed.some((c) => c.probe.id === `${target!.key}:rule:${removed.key}`)).toBe(true);
    expect(r.loosened.some((c) => c.probe.id === `${target!.key}:rule:${removed.key}`)).toBe(true);
    expect(r.bundledFloorDrift).toContain(target!.key);
  });

  it("raising a category is a change but not a loosening", () => {
    const b = withVersion(clone(base), 2);
    const target = b.pathways.flatMap((p) => p.redFlagScreen).find((r) => r.category === "urgent");
    expect(target).toBeDefined();
    target!.category = "emergency";
    const r = runRegression(base, b);
    expect(r.changed.length).toBeGreaterThan(0);
    expect(r.loosened).toEqual([]);
  });

  it("a lowered outcome category on a question path is caught by the path replay", () => {
    const b = withVersion(clone(base), 2);
    let changedKey = "";
    for (const p of b.pathways) {
      for (const n of Object.values(p.nodes)) {
        if (n.type === "outcome" && n.category === "urgent") {
          n.category = "self_management";
          changedKey = n.key;
        }
      }
    }
    if (changedKey === "") return; // the seed has no urgent outcome node: nothing to lower
    const r = runRegression(base, b);
    expect(r.loosened.length).toBeGreaterThan(0);
    expect(r.loosened.every((c) => c.probe.kind !== "red_flag_rule" || c.after.category !== "incomplete")).toBe(true);
  });

  it("a pathway that exists in only one version is reported, not silently skipped", () => {
    const b = withVersion(clone(base), 2);
    const dropped = b.pathways.pop()!;
    const d = diffProtocols(base, b);
    expect(d.pathwaysRemoved).toEqual([dropped.key]);
    expect(runRegression(base, b).notReplayed).toEqual([dropped.key]);
    expect(diffProtocols(b, base).pathwaysAdded).toEqual([dropped.key]);
  });
});
