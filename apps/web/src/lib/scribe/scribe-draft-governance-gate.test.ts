/**
 * AI-017 is registered runtime_governed because supabase/functions/scribe-draft consults ai_runtime_config before it calls a model, in
 * every mode, and fails closed. ai-call-sites.test.ts proves the function reads the config somewhere; this pins the two properties that
 * make the flag honest: the check comes BEFORE the first provider call, and an unregistered or failed lookup returns "disabled".
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(__dirname, "../../../../../supabase/functions/scribe-draft/index.ts"), "utf8");
const HANDLER = SOURCE.slice(SOURCE.indexOf("Deno.serve("));

describe("scribe-draft governance gate", () => {
  it("asks ai_runtime_config for AI-017 before any call to the model provider", () => {
    const gate = HANDLER.indexOf('rpc("ai_runtime_config", { p_system_code: "AI-017" })');
    const firstModelCall = HANDLER.search(/fetch\(\s*["'`]https:\/\/api\.anthropic\.com|callClaude\(|apiRes\s*=\s*await fetch/);
    expect(gate).toBeGreaterThan(-1);
    // A rename that hides the model call must fail this test, not pass it.
    expect(firstModelCall).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstModelCall);
  });

  it("fails closed when the lookup errors, is unregistered or the system is off", () => {
    expect(HANDLER).toMatch(/aiError \|\| !aiCheck \|\| aiCheck\.registered !== true[\s\S]{0,120}status: "disabled"/);
    expect(HANDLER).toMatch(/aiCheck\.enabled !== true[\s\S]{0,120}status: "disabled"/);
  });

  it("gates before the consent lookup and before any mode branch writes a log row", () => {
    const gate = HANDLER.indexOf("ai_runtime_config");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(HANDLER.indexOf('from("scribe_consents")'));
    expect(gate).toBeLessThan(HANDLER.indexOf('from("ai_interaction_log")'));
  });
});
