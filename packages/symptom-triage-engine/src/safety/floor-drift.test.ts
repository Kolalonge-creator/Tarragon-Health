import { describe, expect, it } from "@jest/globals";
import { SEED_PATHWAYS } from "../protocols/index";
import type { PresentingComplaintProtocol } from "../types/index";
import { bundledFloorDrift } from "./floor-drift";

const chest = (): PresentingComplaintProtocol => SEED_PATHWAYS.find((p) => p.key === "chest_pain")!;

/** What the S59b chest pain draft does to the signed pathway: the cardiac pattern loses its severity floor, nothing else changes. */
function withoutCardiacSeverityFloor(p: PresentingComplaintProtocol): PresentingComplaintProtocol {
  return {
    ...p,
    redFlagScreen: p.redFlagScreen.map((f) => {
      if (f.key !== "chest_pain.cardiac_pattern") return f;
      const { minSeverity: _dropped, ...rule } = f.rule as Record<string, unknown>;
      void _dropped;
      return { ...f, rule } as typeof f;
    }),
  };
}

describe("bundled red-flag floor parity (S59b, OQ-S59b-02)", () => {
  it("the bundled floor equals the SIGNED v1 protocol: the cardiac pattern still has its signed severity floor", () => {
    const f = chest().redFlagScreen.find((x) => x.key === "chest_pain.cardiac_pattern");
    expect((f?.rule as { minSeverity?: number }).minSeverity).toBe(6);
    expect(bundledFloorDrift(SEED_PATHWAYS)).toEqual([]);
  });

  it("the draft differs from the signed pathway ONLY in the cardiac pattern having no severity floor", () => {
    const draft = withoutCardiacSeverityFloor(chest());
    const before = chest().redFlagScreen;
    const changed = draft.redFlagScreen.filter((f, i) => JSON.stringify(f) !== JSON.stringify(before[i]));
    expect(changed.map((f) => f.key)).toEqual(["chest_pain.cardiac_pattern"]);
    expect((changed[0]?.rule as { minSeverity?: number }).minSeverity).toBeUndefined();
    expect(draft.nodes).toEqual(chest().nodes);
  });

  it("FAILS LOUDLY (reports drift) the moment a signed protocol drops the floor but the bundled copy is not updated", () => {
    const signedAfterDraft = [...SEED_PATHWAYS.filter((p) => p.key !== "chest_pain"), withoutCardiacSeverityFloor(chest())];
    expect(bundledFloorDrift(signedAfterDraft)).toEqual(["chest_pain"]);
  });
});
