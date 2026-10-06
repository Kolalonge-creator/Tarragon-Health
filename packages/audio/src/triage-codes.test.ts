import { describe, expect, it } from "@jest/globals";
import { TRIAGE_MESSAGE_KEYS } from "@tarragon/clinical";
import { realManifest } from "./test-helpers";

/**
 * The triage engine names a message by code (OQ-87). Every code that is a spoken message must be a clip in the
 * manifest, or the patient gets text with no voice. This test lists the gap that exists today so that closing it,
 * or widening it, is a deliberate change.
 */
describe("triage message codes and the manifest (safety case 1 area)", () => {
  const ids = new Set(realManifest().clips.map((c) => c.id));
  const spoken = Object.keys(TRIAGE_MESSAGE_KEYS).filter((k) => /^(EMG|TRI)-/.test(k));

  it("has a clip for every spoken triage code except the ones recorded as open", () => {
    const missing = spoken.filter((k) => !ids.has(k)).sort();
    // EMG-001L (the low-pressure variant) is not in the Audio Production List. Raised as OQ-202.
    expect(missing).toEqual(["EMG-001L"]);
  });

  it("covers the codes the engine uses most: the emergency, the green, the amber and the recheck", () => {
    for (const k of ["EMG-001", "TRI-001", "TRI-002", "TRI-003", "TRI-005", "TRI-006"]) expect(ids.has(k)).toBe(true);
  });
});
