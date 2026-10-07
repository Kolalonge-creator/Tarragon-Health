import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./proposed-config";
import { bre01Pace, totalBreaths } from "./breathing";

/**
 * Keeps the places that must agree with the PROPOSED registry in step with it (S33). The scorer's command line defaults and
 * the generated BRE-01 script live outside this package, so they are read as text.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const read = (p: string): string => readFileSync(resolve(repo, p), "utf8");

describe("learning and breathing configuration stays in step with the registry", () => {
  it("the understandability scorer's command line defaults equal the registered pass rule", () => {
    const rule = getProposedConfig<{ min_participants: number; min_recall: number; max_unsafe: number }>("learning.understandability_pass_rule").value;
    const cli = read("scripts/learning/score-understandability.mjs");
    expect(cli).toContain(`opt("min-n", ${rule.min_participants})`);
    expect(cli).toContain(`opt("min-recall", ${rule.min_recall})`);
    expect(cli).toContain(`opt("max-unsafe", ${rule.max_unsafe})`);
  });

  it("the pace the BRE-01 script was written for equals the registered pace", () => {
    const { pace } = bre01Pace("standard");
    const src = read("packages/i18n/src/bre01-script.ts");
    expect(src).toContain(`inhaleSeconds: ${pace.inhaleSeconds}, exhaleSeconds: ${pace.exhaleSeconds}, durationSeconds: ${pace.durationSeconds}`);
  });

  it("the generated BRE-01 script counts one breath for every breath in the session", () => {
    const scripts = JSON.parse(read("audio/source/long-form-scripts.json")) as Record<string, { en: string }>;
    const { pace } = bre01Pace("standard");
    const cycles = scripts["BRE-01"].en.split("Breathe in, ").length - 1;
    expect(cycles).toBe(totalBreaths(pace));
    expect(scripts["BRE-01"].en).toContain(`in for ${["zero", "one", "two", "three", "four", "five", "six"][pace.inhaleSeconds]}`);
  });

  it("every lesson that ends by pointing to the breathing exercise points to one that exists", () => {
    const scripts = JSON.parse(read("audio/source/long-form-scripts.json")) as Record<string, { en: string }>;
    expect(scripts["BRE-01"]).toBeDefined();
    expect(scripts["BPC-11"].en).toMatch(/breathing exercise/);
  });
});
