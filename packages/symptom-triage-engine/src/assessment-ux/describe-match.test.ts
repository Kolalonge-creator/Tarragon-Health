/**
 * S59c "describe it": danger screen first, deterministic synonym match second, nothing kept, nothing that reassures.
 */
import { describe, it, expect } from "@jest/globals";
import { DESCRIBE_DRAFT } from "./drafts";
import { describeEntry, matchDescription, describeTableSchema, type DangerScreen } from "./describe-match";

const SIGNED = { ...DESCRIBE_DRAFT, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } };
const ALL = ["headache", "chest_pain", "breathlessness", "fever", "abdominal_pain"];

/** A stand-in for the shared assistant danger screen (the real one is exercised in apps/web, where both packages are available). */
const stubScreen: DangerScreen = (text) => {
  const t = text.toLowerCase();
  return { redFlag: /\b(cannot breathe|can't breathe|faint(ed|ing)?|kill myself|crushing)\b/.test(t), selfHarm: /kill myself/.test(t) };
};

const run = (text: string, over: Partial<{ table: unknown; available: string[]; dangerScreen: DangerScreen }> = {}) =>
  describeEntry(text, { dangerScreen: stubScreen, table: SIGNED, available: ALL, ...over });

describe("the shipped draft", () => {
  it("parses, and is an unsigned draft", () => {
    const parsed = describeTableSchema.parse(DESCRIBE_DRAFT);
    expect(parsed.status).toBe("draft");
    expect(parsed.clinical_sign_off).toBeNull();
  });

  it("matches nothing while unsigned, whatever the words", () => {
    expect(matchDescription("I have a terrible headache", DESCRIBE_DRAFT, ALL)).toEqual({ kind: "no_match" });
    expect(run("I have a terrible headache", { table: DESCRIBE_DRAFT })).toEqual({ kind: "no_match" });
  });

  it("matches nothing when marked signed but with no signer", () => {
    expect(matchDescription("headache", { ...SIGNED, clinical_sign_off: null }, ALL)).toEqual({ kind: "no_match" });
  });

  it("carries no Pidgin and no em dash", () => {
    const all = DESCRIBE_DRAFT.entries.flatMap((e) => e.phrases).join(" | ");
    expect(all).not.toMatch(/\bdey\b|\bwahala\b|\bbelle\b|\bna\b/);
    expect(all).not.toContain("—");
  });
});

describe("matching (signed fixture)", () => {
  it("maps plain and Nigerian English phrasing to one pathway", () => {
    expect(run("I have a bad headache")).toMatchObject({ kind: "match", pathwayKey: "headache" });
    expect(run("my head is paining me since morning")).toMatchObject({ kind: "match", pathwayKey: "headache" });
    expect(run("my body is hot and I am shivering")).toMatchObject({ kind: "match", pathwayKey: "fever" });
    expect(run("my stomach is paining me")).toMatchObject({ kind: "match", pathwayKey: "abdominal_pain" });
    expect(run("difficulty in breathing at night")).toMatchObject({ kind: "match", pathwayKey: "breathlessness" });
  });

  it("is case and spacing insensitive", () => {
    expect(run("  HEADACHE   ")).toMatchObject({ kind: "match", pathwayKey: "headache" });
    expect(run("Chest   Pain")).toMatchObject({ kind: "match", pathwayKey: "chest_pain" });
  });

  it("starts at a word boundary", () => {
    expect(matchDescription("overheadache", SIGNED, ALL)).toEqual({ kind: "no_match" });
    expect(matchDescription("the headache", SIGNED, ALL)).toMatchObject({ kind: "match" });
  });

  it("a weak hint alone is not enough; a hint beside a clear phrase adds to the score", () => {
    expect(matchDescription("sore head", SIGNED, ALL)).toEqual({ kind: "no_match" });
    expect(matchDescription("sore head, heavy head", SIGNED, ALL)).toEqual({ kind: "no_match" }); // one entry counts once
    expect(matchDescription("sore head and a headache", SIGNED, ALL)).toMatchObject({ kind: "match", pathwayKey: "headache", score: 3 });
  });

  it("two clear pathways in one sentence are ambiguous, never auto-picked", () => {
    const r = run("headache and my body is hot");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates.sort()).toEqual(["fever", "headache"]);
  });

  it("a second, weaker complaint is never dropped: any other pathway that scores at all makes it a choice", () => {
    const r = run("headache and my chest is tight");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates).toEqual(["headache", "breathlessness"]);
    // not available: it cannot be offered, so the clear one stands
    expect(run("headache and my chest is tight", { available: ["headache", "chest_pain"] })).toMatchObject({ kind: "match", pathwayKey: "headache" });
  });

  it("property: text that clearly names two different pathways is never a single match", () => {
    const clear: [string, string][] = [["headache", "headache"], ["chest pain", "chest_pain"], ["short of breath", "breathlessness"], ["my body is hot", "fever"], ["stomach pain", "abdominal_pain"]];
    for (const [pa, ka] of clear) for (const [pb, kb] of clear) {
      if (ka === kb) continue;
      for (const joiner of [" and ", ", ", " plus also "]) {
        const r = matchDescription(`${pa}${joiner}${pb}`, SIGNED, ALL);
        expect(r.kind).toBe("ambiguous");
        if (r.kind === "ambiguous") expect([...r.candidates].sort()).toEqual([ka, kb].sort());
      }
    }
  });

  it("never routes to a pathway that is not signed and active", () => {
    expect(run("I have a fever", { available: ["headache"] })).toEqual({ kind: "no_match" });
    expect(run("headache and fever", { available: ["headache"] })).toMatchObject({ kind: "match", pathwayKey: "headache" });
  });

  it("empty, blank and unrelated text could not be matched", () => {
    expect(run("")).toEqual({ kind: "no_match" });
    expect(run("   ")).toEqual({ kind: "no_match" });
    expect(run("I want to ask about my appointment")).toEqual({ kind: "no_match" });
  });

  it("a malformed table matches nothing (fails safe)", () => {
    expect(matchDescription("headache", { nonsense: true }, ALL)).toEqual({ kind: "no_match" });
    expect(matchDescription("headache", null, ALL)).toEqual({ kind: "no_match" });
  });
});

describe("the danger screen comes first", () => {
  it("a danger phrase wins over an exact synonym", () => {
    expect(run("headache and I fainted")).toMatchObject({ kind: "danger", screenFailed: false });
    expect(run("chest pain, crushing")).toMatchObject({ kind: "danger" });
  });

  it("self harm wording is flagged as such", () => {
    expect(run("I want to kill myself")).toMatchObject({ kind: "danger", selfHarm: true });
  });

  it("a danger phrase is found anywhere in a long note, even past the matching window", () => {
    const long = `${"headache ".repeat(100)} and then I fainted`;
    expect(run(long)).toMatchObject({ kind: "danger" });
  });

  it("a screen that throws or answers nonsense counts as danger (fail toward escalation)", () => {
    expect(run("headache", { dangerScreen: () => { throw new Error("boom"); } })).toMatchObject({ kind: "danger", screenFailed: true });
    expect(run("headache", { dangerScreen: (() => undefined) as unknown as DangerScreen })).toMatchObject({ kind: "danger", screenFailed: true });
    expect(run("headache", { dangerScreen: (() => ({ redFlag: "yes" })) as unknown as DangerScreen })).toMatchObject({ kind: "danger", screenFailed: true });
  });

  it("property: whatever surrounds it, text holding a danger phrase is always danger, matched or not", () => {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const words = ["headache", "chest pain", "my body is hot", "stomach pain", "breathless", "hello", "since", "morning", "sore head", "wheezing"];
    for (let i = 0; i < 500; i++) {
      const parts = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => words[Math.floor(rnd() * words.length)]!);
      parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, "I fainted");
      expect(run(parts.join(" ")).kind).toBe("danger");
    }
  });

  it("property: the outcome is never a category, so it can never lower one", () => {
    for (const text of ["headache", "I fainted", "", "gibberish", "chest pain and headache"]) {
      const r = run(text) as Record<string, unknown>;
      expect(r).not.toHaveProperty("category");
      expect(r).not.toHaveProperty("urgency");
    }
  });
});

describe("privacy", () => {
  it("nothing returned contains any of the typed text", () => {
    const secret = "xyzzy-private-word headache";
    for (const text of [secret, `${secret} I fainted`, `${secret} and my body is hot`]) {
      expect(JSON.stringify(run(text))).not.toContain("xyzzy");
    }
  });
});
