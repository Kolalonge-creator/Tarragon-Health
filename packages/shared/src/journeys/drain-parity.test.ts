import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The journey harness drains the bus with its own copy of the port layer (apps/web/e2e-browser/journeys/harness/drain.ts).
// It must call the same database functions as the real edge function, or a journey would prove something the platform does
// not do. This test compares the RPC names and argument keys of the two files.

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const EDGE = readFileSync(join(ROOT, "supabase", "functions", "process-events", "index.ts"), "utf8");
const HARNESS = readFileSync(join(ROOT, "apps", "web", "e2e-browser", "journeys", "harness", "drain.ts"), "utf8");

const rpcs = (src: string): string[] => [...src.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]!).sort();
const argKeys = (src: string): string[] => [...src.matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]!).sort();

describe("harness bus drain mirrors the process-events edge function", () => {
  it("calls the same RPCs", () => {
    expect(rpcs(HARNESS)).toEqual(rpcs(EDGE));
    expect(rpcs(EDGE).length).toBeGreaterThanOrEqual(5);
  });

  it("passes the same argument names", () => {
    expect(argKeys(HARNESS)).toEqual(argKeys(EDGE));
  });

  it("uses the same handler registry and dispatcher instead of its own", () => {
    expect(HARNESS).toContain("supabase/functions/process-events/handlers");
    expect(HARNESS).toContain("supabase/functions/_shared/event-bus/dispatch");
    expect(EDGE).toContain("buildHandlers");
    expect(EDGE).toContain("runBatches");
  });
});

describe("INV-01: no language model in the triage and queue path (static)", () => {
  const dirs = ["supabase/functions/_shared/triage", "supabase/functions/_shared/clinical", "supabase/functions/_shared/queue", "supabase/functions/_shared/event-bus", "supabase/functions/process-events"];
  const files = dirs.flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(ROOT, d, f)));

  it("reads real files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("none of them mentions a model vendor, the governed AI runner, or makes an outbound http call", () => {
    const banned = /anthropic|openai|claude|gemini|runGovernedAi|ai_systems|ai_interaction_log|api\.[a-z]+\.com|https?:\/\//i;
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8")
        // comments may name what is forbidden; only code counts
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const m = text.match(banned);
      if (m) hits.push(`${f.replace(ROOT, "")}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("the check can fail: a sabotaged line is caught", () => {
    const banned = /anthropic|openai|claude|gemini|runGovernedAi|ai_systems|ai_interaction_log|api\.[a-z]+\.com|https?:\/\//i;
    expect(banned.test('const r = await fetch("https://api.anthropic.com/v1/messages")')).toBe(true);
    expect(banned.test("await runGovernedAi(x)")).toBe(true);
  });
});
