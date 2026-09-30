import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getProposedConfig,
  listUnconfirmed,
  PROPOSED_CONFIG,
  UnknownConfigKeyError,
  validateRegistry,
  type ProposedConfigEntry,
} from "./index";

const entry = (over: Partial<ProposedConfigEntry>): ProposedConfigEntry => ({
  key: "a.b",
  value: 1,
  owner: "CMO",
  status: "proposed",
  version: 1,
  effectiveFrom: "2026-01-01",
  source: "test",
  ...over,
});

describe("proposed config loader", () => {
  it("ships a structurally valid registry", () => {
    expect(validateRegistry(PROPOSED_CONFIG)).toEqual([]);
  });

  it("returns the spec value with its version and status", () => {
    const r = getProposedConfig<number>("clinician.max_lead_patients", "2026-10-01");
    expect(r.value).toBe(60);
    expect(r.version).toBe(1);
    expect(r.status).toBe("proposed");
  });

  it("stores money as integer kobo: 12,000 naira is 1,200,000 kobo", () => {
    expect(getProposedConfig("commerce.care_pack_price_kobo").value).toBe(1_200_000);
  });

  it("throws on an unknown key instead of returning a default", () => {
    expect(() => getProposedConfig("no.such_key")).toThrow(UnknownConfigKeyError);
  });

  it("does not apply an entry before its effective date", () => {
    expect(() => getProposedConfig("clinician.max_lead_patients", "2026-01-01")).toThrow(UnknownConfigKeyError);
  });

  it("picks the highest effective version so a confirmation supersedes a proposal", () => {
    const entries = [
      entry({ value: 60, version: 1, effectiveFrom: "2026-01-01" }),
      entry({ value: 50, version: 2, status: "confirmed", effectiveFrom: "2026-06-01" }),
    ];
    expect(getProposedConfig("a.b", "2026-03-01", entries).value).toBe(60);
    const later = getProposedConfig("a.b", "2026-07-01", entries);
    expect(later.value).toBe(50);
    expect(later.version).toBe(2);
    expect(later.status).toBe("confirmed");
    expect(listUnconfirmed("2026-07-01", entries)).toEqual([]);
    expect(listUnconfirmed("2026-03-01", entries)).toHaveLength(1);
  });

  it("lists entries awaiting confirmation, including the unset transcript retention", () => {
    const keys = listUnconfirmed("2026-10-01").map((r) => r.key);
    expect(keys).toContain("privacy.transcript_retention");
  });

  it("validation catches gaps, duplicates, bad dates and non-integer kobo", () => {
    const problems = validateRegistry([
      entry({ key: "x.price_kobo", value: 12.5 }),
      entry({ key: "x.price_kobo", value: 1, version: 3 }),
      entry({ key: "y.z", effectiveFrom: "soon" }),
      entry({ key: "y.z", version: 1 }),
    ]);
    expect(problems.join("|")).toMatch(/must be an integer \(INV-15\)/);
    expect(problems.join("|")).toMatch(/versions must run 1\.\.n/);
    expect(problems.join("|")).toMatch(/effectiveFrom must be YYYY-MM-DD/);
    expect(problems.join("|")).toMatch(/duplicate entry/);
  });
});

/** Repo scan: a PROPOSED value must not be hard-coded in application code. */
describe("no hard-coded PROPOSED values", () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const roots = ["apps", "packages"].map((d) => join(repoRoot, d));
  const SKIP_DIRS = new Set(["node_modules", ".next", "ios", "android", "dist", "build", ".turbo", "e2e", "e2e-browser"]);

  function* walk(dir: string): Generator<string> {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) yield* walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) yield p;
    }
  }

  const registryDir = `packages${sep}shared${sep}src${sep}proposed-config${sep}`;
  const sources = roots.flatMap((r) => [...walk(r)]).filter((p) => !relative(repoRoot, p).startsWith(registryDir));

  it("scans a meaningful number of source files", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("finds no guard pattern in application code", () => {
    const hits: string[] = [];
    for (const e of PROPOSED_CONFIG) {
      for (const g of e.guardPatterns ?? []) {
        const re = new RegExp(g);
        for (const file of sources) {
          const lines = readFileSync(file, "utf8").split("\n");
          lines.forEach((line, i) => {
            if (re.test(line)) hits.push(`${relative(repoRoot, file)}:${i + 1} [${e.key}] ${line.trim()}`);
          });
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("the scan itself discriminates: a sabotaged snippet is caught", () => {
    const care = PROPOSED_CONFIG.find((e) => e.key === "commerce.care_pack_price_kobo");
    const re = new RegExp(care!.guardPatterns![0]);
    expect(re.test("const price = 1_200_000;")).toBe(true);
    expect(re.test("const price = getProposedConfig('commerce.care_pack_price_kobo').value;")).toBe(false);
  });
});
