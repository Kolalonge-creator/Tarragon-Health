import { describe, expect, it } from "@jest/globals";
import { therapyProgrammeConfig } from "../therapy-programmes";
import { THERAPY_WAVE_A_CONTENT, therapyClipId } from "./wave-a-drafts";

const all = THERAPY_WAVE_A_CONTENT.flatMap((p) => [
  { where: `${p.code} summary`, text: p.summary },
  { where: `${p.code} title`, text: p.title },
  ...p.sessions.flatMap((s) => [
    { where: `${p.code} ${s.ordinal} title`, text: s.title },
    { where: `${p.code} ${s.ordinal} body`, text: s.body },
  ]),
]);

describe("Wave A content drafts: copy rules", () => {
  it("holds the three Wave A programmes with the planned number of sessions", () => {
    expect(THERAPY_WAVE_A_CONTENT.map((p) => [p.code, p.sessions.length])).toEqual([
      ["panic_breathing", 6],
      ["pelvic_floor", 12],
      ["ibs_hypnotherapy", 6],
    ]);
    for (const p of THERAPY_WAVE_A_CONTENT) {
      expect(p.sessions.map((s) => s.ordinal)).toEqual(p.sessions.map((_, i) => i + 1));
      for (const s of p.sessions) expect(s.durationSeconds).toBeGreaterThan(0);
    }
  });

  it("uses no em dash, no 'cure', no 'your doctor', no phone number, no helpline, no AI wording", () => {
    const rules: Array<[string, RegExp]> = [
      ["em dash", /—/],
      ["cure", /\bcur(e|es|ed|ing)\b/i],
      ["your doctor", /your doctors?\b/i],
      ["phone number", /(\+?\d[\d\s-]{6,}\d)/],
      ["helpline", /help ?line|hotline|call \d/i],
      ["AI wording", /\b(AI|A\.I\.|artificial intelligence|chatbot|algorithm)\b/],
      ["outcome claim", /\b(proven|guarantee[sd]?|clinically (proven|shown)|studies show|trials? (show|found))\b/i],
    ];
    const hits: string[] = [];
    for (const { where, text } of all) for (const [name, re] of rules) if (re.test(text)) hits.push(`${where}: ${name}`);
    expect(hits).toEqual([]);
  });

  it("says in the first session that it is self-help and not treatment, and names the care team", () => {
    for (const p of THERAPY_WAVE_A_CONTENT) {
      const first = p.sessions[0]?.body ?? "";
      expect(first).toMatch(/self-help/i);
      expect(first).toMatch(/care team/i);
    }
  });

  it("the panic programme is audio-paced breathing only: no breath holding, no carbon dioxide, no hardware", () => {
    const panic = THERAPY_WAVE_A_CONTENT.find((p) => p.code === "panic_breathing");
    const text = (panic?.sessions ?? []).map((s) => s.body).join(" ");
    expect(text).toMatch(/never hold it/i);
    expect(text).not.toMatch(/carbon dioxide|CO2|capnograph|sensor|device|hold your breath/i);
    for (const s of panic?.sessions ?? []) expect(s.body).toMatch(/nearest hospital now/i);
  });

  it("the pelvic floor dose in the text is the configured dose (8 squeezes, three times a day, 3 months)", () => {
    const cfg = therapyProgrammeConfig().pelvic_floor;
    const pelvic = THERAPY_WAVE_A_CONTENT.find((p) => p.code === "pelvic_floor");
    const session3 = pelvic?.sessions.find((s) => s.ordinal === 3)?.body ?? "";
    expect(session3).toContain(`at least ${cfg.contractions_per_set} squeezes`);
    expect(session3).toContain("three times a day");
    expect(cfg.sets_per_day).toBe(3);
    expect(session3).toContain(`at least ${cfg.minimum_months} months`);
  });

  it("the IBS sessions are 15 minute recordings", () => {
    const ibs = THERAPY_WAVE_A_CONTENT.find((p) => p.code === "ibs_hypnotherapy");
    for (const s of ibs?.sessions ?? []) expect(s.durationSeconds).toBe(900);
  });

  it("clip ids are unique and well formed", () => {
    const ids = THERAPY_WAVE_A_CONTENT.flatMap((p) => p.sessions.map((s) => therapyClipId(p.clip, s.ordinal)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("THP-PAN01");
    expect(ids.at(-1)).toBe("THP-IBS06");
  });
});
