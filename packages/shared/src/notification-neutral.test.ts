import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_PARAM_KEYS, FORBIDDEN_TERMS, lintText } from "./notification-neutral";

const EDGE = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "functions", "_shared", "notifications", "neutral.ts");

function list(src: string, name: string): string[] {
  const body = new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`).exec(src)?.[1];
  if (!body) throw new Error(`${name} not found in the edge copy`);
  return [...body.replace(/\/\/.*$/gm, "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] as string);
}

describe("notification neutral lint (app copy of the edge copy)", () => {
  const edge = readFileSync(EDGE, "utf8");
  it("has the same term list as the edge copy", () => {
    expect([...FORBIDDEN_TERMS]).toEqual(list(edge, "FORBIDDEN_TERMS"));
  });
  it("has the same forbidden parameter keys as the edge copy", () => {
    expect([...FORBIDDEN_PARAM_KEYS]).toEqual(list(edge, "FORBIDDEN_PARAM_KEYS"));
  });
  it("has the same number and emoji rules as the edge copy", () => {
    const grab = (s: string) => /const numberPatterns[\s\S]*?\];/.exec(s)?.[0] ?? "";
    expect(grab(readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "notification-neutral.ts"), "utf8"))).toEqual(grab(edge));
    const emoji = (s: string) => /const emojiPattern = .*;/.exec(s)?.[0] ?? "";
    expect(emoji(readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "notification-neutral.ts"), "utf8"))).toEqual(emoji(edge));
  });
  it("flags clinical wording and passes a neutral nudge", () => {
    expect(lintText("Your blood pressure reading is high").length).toBeGreaterThan(0);
    expect(lintText("Take a short walk today, you have got this").length).toBe(0);
  });
});
