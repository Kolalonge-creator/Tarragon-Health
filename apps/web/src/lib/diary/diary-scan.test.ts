import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { en } from "@tarragon/i18n";
import { DIARY_PROBLEMS } from "@tarragon/shared";

/**
 * Repo scans for the paper diary (S07y), each of which fails the day someone breaks the rule it states:
 *  1. the diary's model call is registered and governed: the reader file is the ONLY place in the diary module that reaches a model, it calls runGovernedAi with
 *     the registered AI-021 code, and AI-021 is in the AI_SYSTEMS mirror;
 *  2. the model is never in a triage or red-flag path (INV-01): no triage, rule-engine, classification or alerting module imports the diary reader;
 *  3. nothing in the diary module touches a table other than vitals_readings (the one record path), profiles (the organisation) and offline_sync_config (a read of the
 *     window), so a suggestion cannot be
 *     written anywhere but through the confirmed, ordinary reading insert;
 *  4. every reason a row can be refused has plain words in the catalogue, and none of them is a diagnosis or a fear line.
 */

const SRC = join(__dirname, "..", "..");
const DIARY = __dirname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the diary reader is a registered, governed call site", () => {
  const files = walk(DIARY);
  it("only read-diary-page.ts reaches a model", () => {
    const offenders = files.filter((f) => /@langchain\/anthropic|@anthropic-ai\/sdk/.test(readFileSync(f, "utf8"))).map((f) => relative(DIARY, f));
    expect(offenders).toEqual(["read-diary-page.ts"]);
  });
  it("it calls runGovernedAi with AI_SYSTEMS.paperDiaryReader, and AI-021 is in the registry mirror", () => {
    const reader = readFileSync(join(DIARY, "read-diary-page.ts"), "utf8");
    expect(reader).toMatch(/runGovernedAi</);
    expect(reader).toMatch(/AI_SYSTEMS\.paperDiaryReader\.code/);
    const codes = readFileSync(join(SRC, "lib", "ai-governance", "system-codes.ts"), "utf8");
    expect(codes).toMatch(/paperDiaryReader:\s*\{\s*code:\s*"AI-021"/);
  });
  it("no other code names the model call or the model id", () => {
    const outside = walk(SRC).filter((f) => !f.startsWith(DIARY) && /extractDiaryPage|readDiaryPage|DIARY_READER_MODEL_ID/.test(readFileSync(f, "utf8")));
    // the two handler doors live in the diary module itself; nothing outside it (and in particular no triage code) imports the reader
    expect(outside.map((f) => relative(SRC, f))).toEqual([]);
  });
});

describe("the model is never in a triage or red-flag path (INV-01)", () => {
  it("no triage, rules, symptom-triage, clinical-rules or alerting module imports the diary module", () => {
    const risky = walk(SRC).filter((f) => /[\\/](lib[\\/](rules|triage|symptom-triage|clinical-rules|emergency|escalation|alerts?)|app[\\/]api[\\/]cron)[\\/]/.test(f));
    const offenders = risky.filter((f) => /@\/lib\/diary/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe("the diary module writes only through the ordinary reading insert", () => {
  const code = walk(DIARY).filter((f) => !/guards\.ts$/.test(f));
  it("touches no table but vitals_readings, profiles (the organisation) and the offline configuration (the window the database will apply)", () => {
    const tables = new Set<string>();
    for (const f of code) for (const m of readFileSync(f, "utf8").matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)) tables.add(m[1] as string);
    expect([...tables].sort()).toEqual(["offline_sync_config", "profiles", "vitals_readings"]);
  });
  it("never stores a photo (no storage, no upload, no file write)", () => {
    for (const f of code) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\.storage\b|\.upload\(|writeFile|createWriteStream/);
    }
  });
  it("never sets taken_at itself: the database decides which time to keep", () => {
    const save = readFileSync(join(DIARY, "save-diary-readings.ts"), "utf8");
    expect(save).not.toMatch(/taken_at\s*:/);
    expect(save).toMatch(/client_recorded_at/);
  });
});

describe("the words", () => {
  it("every problem has plain words, with no diagnosis and no fear line", () => {
    for (const p of DIARY_PROBLEMS) {
      const text = (en as Record<string, string>)[`diary.problem.${p}`];
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/diagnos|dangerous|emergency|warning|urgent|serious/i);
    }
  });
});
