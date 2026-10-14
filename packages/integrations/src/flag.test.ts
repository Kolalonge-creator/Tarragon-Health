import { describe, expect, it } from "@jest/globals";
import { featureFlagOn, type FlagReader } from "../../../supabase/functions/_shared/integrations/index.ts";

const reader = (result: () => Promise<{ data: unknown; error: unknown }> | { data: unknown; error: unknown }): FlagReader => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve().then(result) }) }) }),
});

describe("featureFlagOn", () => {
  it("is true only for status on", async () => {
    expect(await featureFlagOn(reader(() => ({ data: { status: "on" }, error: null })), "k")).toBe(true);
    for (const status of ["off", "rollout", "archived", undefined]) {
      expect(await featureFlagOn(reader(() => ({ data: { status }, error: null })), "k")).toBe(false);
    }
  });
  it("is false for a missing flag, a read error or a throw", async () => {
    expect(await featureFlagOn(reader(() => ({ data: null, error: null })), "k")).toBe(false);
    expect(await featureFlagOn(reader(() => ({ data: { status: "on" }, error: { message: "x" } })), "k")).toBe(false);
    expect(await featureFlagOn(reader(() => { throw new Error("socket"); }), "k")).toBe(false);
  });
});
