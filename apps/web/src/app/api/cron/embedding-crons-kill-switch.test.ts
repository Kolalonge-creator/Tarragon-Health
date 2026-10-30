/**
 * Audit G-08: the two daily content-embedding crons honour AI-009's kill switch. Before this, switching AI-009 off stopped the query-time
 * search but both crons kept calling the embedding provider. The control cases (switch on) make sure the tests cannot pass by always
 * skipping, and the unauthorised case shows the secret check still comes first.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const populateContent = jest.fn(async (..._a: unknown[]) => ({ embedded: 3 }));
const populateHealth = jest.fn(async (..._a: unknown[]) => ({ embedded: 5 }));
const rpc = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.mock("server-only", () => ({}));
jest.mock("@/lib/lifestyle/embed-content", () => ({ populateContentEmbeddings: (...a: unknown[]) => populateContent(...a) }));
jest.mock("@/lib/ai-coach/knowledge-base", () => ({ populateHealthEducationEmbeddings: (...a: unknown[]) => populateHealth(...a) }));
jest.mock("@/lib/lifestyle/voyage-embedder", () => ({ createVoyageEmbedderFromEnv: () => null }));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { GET as lpe } from "./lpe-embed-content/route";
import { GET as coach } from "./ai-coach-embed-content/route";
import { __clearAiGovernanceCache } from "@/lib/ai-governance";

const SECRET = "s".repeat(32);
const authed = () => new Request("http://x/api/cron", { headers: { authorization: `Bearer ${SECRET}` } });

function config(enabled: boolean) {
  return {
    data: {
      registered: true,
      system_code: "AI-009",
      system_id: "00000000-0000-0000-0000-000000000009",
      name: "Lifestyle embeddings",
      enabled,
      runtime_governed: true,
      lifecycle_status: "live",
      risk_class: "low",
      autonomy_level: "assist",
      clinically_meaningful: false,
      fallback_behaviour: "Keyword search.",
      disabled_reason: enabled ? null : "Paused.",
      expected_model_identifier: "voyage-3",
      prompt: null,
      guardrails: [],
      knowledge_sources: [],
    },
    error: null,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  populateContent.mockClear();
  populateHealth.mockClear();
  rpc.mockReset();
  __clearAiGovernanceCache();
});

describe.each([
  ["lpe-embed-content", lpe, populateContent],
  ["ai-coach-embed-content", coach, populateHealth],
] as const)("%s", (_name, GET, populate) => {
  it("does nothing, and says why, when AI-009 is switched off", async () => {
    rpc.mockResolvedValue(config(false));
    const res = await GET(authed());
    expect(await res.json()).toEqual({ skipped: true, reason: "kill_switch" });
    expect(populate).not.toHaveBeenCalled();
  });

  it("CONTROL: runs when AI-009 is on", async () => {
    rpc.mockResolvedValue(config(true));
    const res = await GET(authed());
    expect(await res.json()).toEqual(expect.objectContaining({ embedded: expect.any(Number) }));
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it("still refuses a caller without the cron secret, before reading the registry", async () => {
    const res = await GET(new Request("http://x/api/cron"));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(populate).not.toHaveBeenCalled();
  });
});
