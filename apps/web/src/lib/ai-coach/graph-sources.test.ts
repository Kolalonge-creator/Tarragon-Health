/**
 * Through the real graph: a health-information question that retrieves a reviewed row returns that row as a source (owner, version,
 * review date), a lapsed or ownerless row is dropped and the answer is refused in code, and the model is the only thing stubbed.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { Database } from "@tarragon/shared";

const mockRetrievable = { value: true };
jest.mock("./escalate", () => ({
  logAiCoachEscalation: jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" })),
  logAiCoachReviewFlag: jest.fn(async () => ({ clinicianAlertId: "a2" })),
}));
jest.mock("./context", () => ({
  loadPatientContext: jest.fn(async () => ({
    demographics: { ageYears: 50, sex: "female" },
    elevatedConditions: [],
    highRiskConditions: [],
    isPregnant: false,
    possibleMinor: false,
    lifestyleProgrammes: [],
  })),
}));
jest.mock("@/lib/lifestyle/find-relevant-content", () => ({ findRelevantLifestyleContent: jest.fn(async () => []) }));
jest.mock("./knowledge-base", () => ({
  findRelevantHealthEducationContent: jest.fn(async () => [
    { id: "kb-1", code: "salt", title: "Salt and blood pressure", excerpt: "Less salt helps.", condition: null, similarity: 0.9 },
  ]),
}));
jest.mock("./knowledge-sources", () => {
  const actual = jest.requireActual("./knowledge-sources") as Record<string, unknown>;
  return {
    ...actual,
    loadKnowledgeSources: jest.fn(async () =>
      new Map([
        [
          "kb-1",
          {
            id: "kb-1",
            sourceTable: "health_education_content",
            title: "Salt and blood pressure",
            owner: "Dr A. Obi",
            version: 3,
            reviewDueAt: "2027-02-01T00:00:00Z",
            retrievable: mockRetrievable.value,
          },
        ],
      ])
    ),
  };
});

import { buildCoachGraph, NO_REVIEWED_SOURCE_REPLY } from "./graph";

function stubModel(structured: Record<string, unknown>) {
  return {
    bindTools: () => ({ invoke: async () => ({ tool_calls: [] }) }),
    withStructuredOutput: () => ({ invoke: async () => structured }),
  } as unknown as ChatAnthropic;
}

const base = { profileId: "p1", organisationId: "o1", conversationId: "c1", priorMessages: [] };
const supabase = { from: jest.fn(), rpc: jest.fn() } as unknown as SupabaseClient<Database>;

describe("sources through the graph (spec 7.2, 7.9)", () => {
  it("returns the reviewed row as a source with owner, version and review date", async () => {
    mockRetrievable.value = true;
    const graph = buildCoachGraph({
      supabase,
      getServiceRoleSupabase: () => supabase,
      model: stubModel({ tier: "routine", reply: "Cutting back on salt helps your pressure.", suggestedAction: "none", isHealthInformationRequest: true }),
    });
    const out = await graph.invoke({ ...base, incomingMessage: "does salt affect my blood pressure" });
    expect(out.sources).toEqual([
      { kind: "reviewed_content", title: "Salt and blood pressure", owner: "Dr A. Obi", version: 3, reviewDue: "2027-02-01" },
    ]);
    expect(out.retrievedSourceIds).toEqual(["kb-1"]);
    expect(out.reply).toContain("Cutting back on salt");
  });

  it("drops a row whose review has lapsed and refuses to answer from general knowledge", async () => {
    mockRetrievable.value = false;
    const graph = buildCoachGraph({
      supabase,
      getServiceRoleSupabase: () => supabase,
      model: stubModel({ tier: "routine", reply: "From my own memory, salt raises pressure.", suggestedAction: "none", isHealthInformationRequest: true }),
    });
    const out = await graph.invoke({ ...base, incomingMessage: "does salt affect my blood pressure" });
    expect(out.retrievedSourceIds).toEqual([]);
    expect(out.sources).toEqual([]);
    expect(out.reply).toBe(NO_REVIEWED_SOURCE_REPLY);
  });
});
