import { describe, expect, it } from "@jest/globals";
import { MSK_SETTINGS } from "../proposed-config/msk-config-data";
import { therapyProgrammeConfig } from "../therapy-programmes";
import { MSK_EXERCISES, THERAPY_MSK_CONTENT, mskExerciseRow } from "./msk-drafts";
import { MSK_DRAWINGS, MSK_DRAWING_ALT, renderMskSvg } from "./msk-illustrations";

const texts = [
  ...Object.values(MSK_EXERCISES).flatMap((e) => [
    { where: `exercise ${e.key} name`, text: e.name },
    ...e.steps.map((t, i) => ({ where: `exercise ${e.key} step ${i + 1}`, text: t })),
    { where: `exercise ${e.key} dose`, text: e.dose },
    { where: `exercise ${e.key} easier`, text: e.easier },
    { where: `exercise ${e.key} harder`, text: e.harder },
    { where: `exercise ${e.key} stop`, text: e.stopIf },
  ]),
  ...THERAPY_MSK_CONTENT.flatMap((p) => [
    { where: `${p.code} title`, text: p.title },
    { where: `${p.code} summary`, text: p.summary },
    ...p.sessions.flatMap((s) => [
      { where: `${p.code} ${s.ordinal} title`, text: s.title },
      { where: `${p.code} ${s.ordinal} body`, text: s.body },
    ]),
  ]),
  ...Object.entries(MSK_DRAWING_ALT).map(([k, v]) => ({ where: `alt ${k}`, text: v })),
];

describe("MSK programme content drafts: shape", () => {
  it("holds the four programmes with eight weekly sessions each", () => {
    expect(THERAPY_MSK_CONTENT.map((p) => [p.code, p.sessions.length])).toEqual([
      ["pain_back", 8],
      ["pain_neck", 8],
      ["pain_knee", 8],
      ["pain_hip", 8],
    ]);
    for (const p of THERAPY_MSK_CONTENT) expect(p.sessions.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("every day-set respects the configured daily cap and holds at least one gentle exercise", () => {
    expect(MSK_SETTINGS.daily_exercise_cap).toBe(therapyProgrammeConfig().msk.daily_exercise_cap);
    for (const p of THERAPY_MSK_CONTENT) {
      for (const s of p.sessions) {
        expect(s.exercises.length).toBeGreaterThanOrEqual(1);
        expect(s.exercises.length).toBeLessThanOrEqual(MSK_SETTINGS.daily_exercise_cap);
        expect(new Set(s.exercises).size).toBe(s.exercises.length);
        expect(s.exercises.some((k) => MSK_EXERCISES[k]?.intensity === "gentle")).toBe(true);
        for (const k of s.exercises) expect(MSK_EXERCISES[k]).toBeDefined();
      }
    }
  });

  it("every exercise has steps, a dose, an easier and a harder version, a stop rule, a drawing and alt text", () => {
    for (const e of Object.values(MSK_EXERCISES)) {
      expect(e.steps.length).toBeGreaterThanOrEqual(3);
      expect(e.dose.length).toBeGreaterThan(0);
      expect(e.easier.length).toBeGreaterThan(0);
      expect(e.harder.length).toBeGreaterThan(0);
      expect(e.stopIf).toMatch(/stop/i);
      expect(MSK_DRAWINGS[e.key]?.length ?? 0).toBeGreaterThan(2);
      expect((MSK_DRAWING_ALT[e.key] ?? "").length).toBeGreaterThan(30);
      expect(mskExerciseRow(e.key).alt).toBe(MSK_DRAWING_ALT[e.key]);
    }
    expect(Object.keys(MSK_DRAWINGS).sort()).toEqual(Object.keys(MSK_EXERCISES).sort());
  });

  it("week 1 asks for the outcome questions, week 4 is a check-in, week 8 looks back", () => {
    for (const p of THERAPY_MSK_CONTENT) {
      expect(p.sessions[0]?.body).toMatch(/self-help/i);
      expect(p.sessions[0]?.body).toMatch(/care team/i);
      expect(p.sessions[0]?.body).toMatch(/four short questions/i);
      expect(p.sessions[3]?.body).toMatch(/four short questions/i);
      expect(p.sessions[7]?.body).toMatch(/four short questions/i);
    }
  });

  it("every session names the hospital route and the flare-up button", () => {
    for (const p of THERAPY_MSK_CONTENT) {
      for (const s of p.sessions) {
        expect(s.body).toMatch(/nearest hospital now/i);
        expect(s.body).toMatch(/My pain got worse/);
      }
    }
  });
});

describe("MSK programme content drafts: copy rules", () => {
  it("uses no em dash, no 'cure', no 'your doctor', no phone number, no helpline, no AI wording, no outcome claim", () => {
    const rules: Array<[string, RegExp]> = [
      ["em dash", /—/],
      ["cure", /\bcur(e|es|ed|ing)\b/i],
      ["your doctor", /your doctors?\b/i],
      ["phone number", /(\+?\d[\d\s-]{6,}\d)/],
      ["helpline", /help ?line|hotline|call \d/i],
      ["AI wording", /\b(AI|A\.I\.|artificial intelligence|chatbot|algorithm)\b/],
      ["outcome claim", /\b(proven|guarantee[sd]?|clinically (proven|shown)|studies show|trials? (show|found))\b/i],
      ["fear wording", /\b(warning|danger of|dangerous|terrify|crippl|permanent damage|you must)\b/i],
    ];
    const hits: string[] = [];
    for (const { where, text } of texts) for (const [name, re] of rules) if (re.test(text)) hits.push(`${where}: ${name}`);
    expect(hits).toEqual([]);
  });

  it("is written in short sentences (a plain reading level)", () => {
    const long: string[] = [];
    for (const { where, text } of texts) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (sentence.split(/\s+/).length > 40) long.push(`${where}: ${sentence.slice(0, 60)}`);
      }
    }
    expect(long).toEqual([]);
  });
});

describe("MSK drawings", () => {
  it("each renders as a tiny, self-contained, accessible SVG with no external reference", () => {
    for (const key of Object.keys(MSK_EXERCISES)) {
      const svg = renderMskSvg(key);
      expect(svg).not.toBeNull();
      const s = svg as string;
      expect(s.length).toBeLessThan(2500);
      expect(s).toContain('role="img"');
      expect(s).toContain("<title>");
      expect(s).toMatch(/aria-label="[^"]{30,}"/);
      expect(s).not.toMatch(/https?:\/\/(?!www\.w3\.org)|<image|href=|<script|<style|url\(/i);
    }
  });

  it("uses the text colour for the body so light and dark mode both stay readable", () => {
    expect(renderMskSvg("walk")).toContain('stroke="currentColor"');
  });

  it("an unknown key renders nothing", () => {
    expect(renderMskSvg("no_such_exercise")).toBeNull();
  });
});
