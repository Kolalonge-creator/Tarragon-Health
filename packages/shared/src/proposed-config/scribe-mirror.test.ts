import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const FUNCTION = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "supabase", "functions", "scribe-draft", "index.ts",
);

describe("scribe.* mirrors the scribe-draft edge function constants", () => {
  const source = readFileSync(FUNCTION, "utf8");

  it("SCRIBE_CLAUDE_MODEL equals scribe.claude_model", () => {
    const m = /const SCRIBE_CLAUDE_MODEL = "([^"]+)";/.exec(source);
    if (!m?.[1]) throw new Error("SCRIBE_CLAUDE_MODEL not found in the edge function");
    expect(m[1]).toBe(getProposedConfig("scribe.claude_model").value);
  });

  it("SCRIBE_CLAUDE_MAX_TOKENS equals scribe.claude_max_tokens", () => {
    const m = /const SCRIBE_CLAUDE_MAX_TOKENS = (\d+);/.exec(source);
    if (!m?.[1]) throw new Error("SCRIBE_CLAUDE_MAX_TOKENS not found in the edge function");
    expect(Number(m[1])).toBe(getProposedConfig("scribe.claude_max_tokens").value);
  });

  it("calls ai_runtime_config with the real argument name and reads the real result key", () => {
    expect(source).toContain('{ p_system_code: "AI-017" }');
    expect(source).toContain("aiCheck.enabled");
    expect(source).not.toContain("aiCheck.is_enabled");
  });
});
