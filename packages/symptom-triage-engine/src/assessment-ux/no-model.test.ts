/**
 * S59c source scan (INV-01): nothing in the assessment-experience modules calls a model, an embedding service, the network, a clock or a
 * source of randomness, and none of them stores anything. They are pure functions over the arguments they are given.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "@jest/globals";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** Strip comments so a sentence that merely MENTIONS a forbidden word (like this file's own docs) is not a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("assessment-ux modules are deterministic and offline", () => {
  it("covers every module in the directory", () => {
    expect(FILES).toEqual(expect.arrayContaining(["checkback.ts", "describe-match.ts", "drafts.ts", "explainer.ts", "safety-net.ts", "ux-config.ts", "view.ts"]));
  });
  for (const f of FILES) {
    it(`${f}: no model, embedding, network, clock, randomness or storage`, () => {
      const src = code(readFileSync(join(DIR, f), "utf8"));
      expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|\bimport\s*\(|require\s*\(/);
      expect(src).not.toMatch(/anthropic|openai|claude|embedding|vector|llm\b|completion/i);
      expect(src).not.toMatch(/Math\.random|Date\.now|new Date\s*\(|performance\.now/);
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|AsyncStorage/);
    });
  }
});
