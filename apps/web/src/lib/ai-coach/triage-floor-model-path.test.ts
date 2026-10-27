/**
 * Model-path check for the triage floor (INV-01). Every EMERGENCY vignette in the versioned set is sent through the real assistant turn
 * graph with a model that fails the test if it is touched: the reply must be emergency guidance, the care team must be alerted, and the
 * model must never be reached. A non-urgent vignette must not be classed as an emergency by the keyword step that runs before the model.
 * The vignettes are UNSIGNED engineer-written text (clinician_signed is false throughout); this test proves the path, not clinical wording.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { Database } from "@tarragon/shared";
import { parseVignetteSet } from "@tarragon/clinical";

const logAiCoachEscalation = jest.fn(async () => ({ clinicianAlertId: "a1", escalationId: "e1", careMessageThreadId: "t1" }));
const logAiCoachReviewFlag = jest.fn(async () => ({ clinicianAlertId: "a2" }));
jest.mock("./escalate", () => ({ logAiCoachEscalation, logAiCoachReviewFlag }));

import { buildCoachGraph } from "./graph";
import { detectEmergencyKeywords } from "./keyword-guardrail";

const set = parseVignetteSet(
  JSON.parse(readFileSync(join(__dirname, "../../../../../packages/clinical/fixtures/triage-floor-vignettes.v1.json"), "utf8")),
);
const emergencies = set.vignettes.filter((v) => v.kind === "emergency");
const nonUrgent = set.vignettes.filter((v) => v.kind === "non_urgent");

function build() {
  const touched = jest.fn();
  const model = new Proxy(
    {},
    {
      get() {
        touched();
        throw new Error("the model must not be reached");
      },
    },
  ) as unknown as ChatAnthropic;
  const insert = jest.fn(async () => ({ error: null }));
  const supabase = { from: jest.fn(() => ({ insert })) } as unknown as SupabaseClient<Database>;
  const graph = buildCoachGraph({ supabase, getServiceRoleSupabase: () => supabase, model });
  return { graph, touched };
}

const base = { profileId: "p1", organisationId: "o1", conversationId: "c1", priorMessages: [] };

describe("triage floor model path: an emergency never reaches the model", () => {
  it("has the emergency vignettes to run", () => {
    expect(emergencies.length).toBeGreaterThanOrEqual(60);
  });

  it.each(emergencies.map((v) => [v.id, v.category, v.text] as const))("%s (%s) returns emergency guidance with no model call", async (_id, _cat, text) => {
    logAiCoachEscalation.mockClear();
    const { graph, touched } = build();
    const out = await graph.invoke({ ...base, incomingMessage: text });
    expect(out.tier).toBe("emergency");
    expect(typeof out.reply).toBe("string");
    expect((out.reply ?? "").length).toBeGreaterThan(20);
    expect(out.modelId).toBeNull();
    expect(touched).not.toHaveBeenCalled();
    expect(logAiCoachEscalation).toHaveBeenCalledTimes(1);
  });
});

describe("triage floor: the keyword step does not call a non-urgent vignette an emergency", () => {
  it.each(nonUrgent.map((v) => [v.id, v.category, v.text] as const))("%s (%s)", (_id, cat, text) => {
    // information_and_history vignettes are the measured, accepted over-triage cases (see the report in the clinical package test)
    if (cat === "information_and_history") return;
    expect(detectEmergencyKeywords(text)).toBe(false);
  });
});
