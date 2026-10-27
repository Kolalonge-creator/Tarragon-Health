import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";

describe("AI monitoring sign-off view", () => {
  it("shows exactly the proposed rules, in words, and refuses a config it cannot read in full", async () => {
    const { aiMonitoringRulesView } = await import("./pending-ai-monitoring-signoff");
    const cfg = getProposedConfig("ai.monitoring_rules").value;
    const v = aiMonitoringRulesView(cfg);
    expect(v).toEqual({
      sampleRatePercent: 5,
      alwaysSampled: ["conversations that touched an emergency or doctor-escalation grade", "answers a patient said were wrong", "unusually large calls"],
      costSpikeFactor: 3,
      costSpikeMinTokens: 4000,
    });
    expect(aiMonitoringRulesView({})).toBeNull();
    expect(aiMonitoringRulesView({ ...(cfg as object), always_sample: ["something_new"] })).toBeNull();
    expect(aiMonitoringRulesView({ ...(cfg as object), cost_spike: { factor: "3" } })).toBeNull();
  });
});
