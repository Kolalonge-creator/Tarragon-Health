/**
 * S65: the on-device emergency logic and the bundled pack. The offline test runs with the network made to throw, the parity tests read
 * the live SQL classifiers out of the migrations, and the pack tests hold the CMO decisions (Q17 content, Q18 no numbers) in place.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "@tarragon/shared";
import {
  activeEmergencyPack, classifyPulse, classifySpo2, classifyTemperature, deviceRedFlags, emergencyFacilitiesForState, emergencyForText,
  findNumbersInPack, needsHospitalNow, topicByKey, type DeviceRedRules, type PackLike,
} from "./emergency-pack";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const mig = (name: string) => readFileSync(join(ROOT, "supabase", "migrations", name), "utf8");
const rules = getProposedConfig<DeviceRedRules & Record<string, never>>("vitals.device_red_rules").value as unknown as DeviceRedRules;
const pack = getProposedConfig("emergency.pack").value as unknown as PackLike;

/** Evaluate a SQL `case when <cond> then '<level>' ... end` body for one input, where a cond is `p_x <op> N` joined by `or`. */
function sqlLevel(file: string, fn: string, value: number): string {
  const src = mig(file);
  const start = src.indexOf(`function private.${fn}`);
  const body = src.slice(start, src.indexOf("$$;", src.indexOf("as $$", start)));
  const whens = [...body.matchAll(/when\s+(.+?)\s+then\s+'(\w+)'/g)];
  if (whens.length < 3) throw new Error(`could not read the cases of ${fn}`);
  for (const [, cond, level] of whens) {
    if (/is null/.test(cond!)) continue;
    const ok = cond!.split(/\s+or\s+/).some((c) => {
      const m = /p_\w+\s*(<=|>=|<|>)\s*(-?[0-9.]+)/.exec(c);
      if (!m) throw new Error(`unreadable condition ${c}`);
      const n = Number(m[2]);
      return m[1] === "<=" ? value <= n : m[1] === ">=" ? value >= n : m[1] === "<" ? value < n : value > n;
    });
    if (ok) return level!;
  }
  return (/else\s+'(\w+)'/.exec(body) ?? [])[1] ?? "unknown";
}

describe("device red rules mirror the live SQL classifiers (parity)", () => {
  it("pulse agrees at every whole bpm from 20 to 300", () => {
    for (let v = 20; v <= 300; v++) expect({ v, level: classifyPulse(v, rules) }).toEqual({ v, level: sqlLevel("20260829140000_pulse_red_flag_engine.sql", "classify_pulse_level", v) });
  });
  it("SpO2 agrees at every whole percent from 50 to 100", () => {
    for (let v = 50; v <= 100; v++) expect({ v, level: classifySpo2(v, rules) }).toEqual({ v, level: sqlLevel("20260807090139_spo2_red_flag_engine.sql", "classify_spo2_level", v) });
  });
  it("temperature agrees at every tenth of a degree from 30.0 to 45.0", () => {
    for (let t = 300; t <= 450; t++) {
      const v = t / 10;
      expect({ v, level: classifyTemperature(v, rules) }).toEqual({ v, level: sqlLevel("20260807090237_temperature_red_flag_engine.sql", "classify_temperature_level", v) });
    }
  });
  it("the parity check can fail (sabotage control): a moved threshold is caught", () => {
    const moved = { ...rules, pulse_bpm: { ...rules.pulse_bpm, emergency_at_or_above: 160 } };
    expect(classifyPulse(155, moved)).not.toBe(sqlLevel("20260829140000_pulse_red_flag_engine.sql", "classify_pulse_level", 155));
  });
  it("a missing value is unknown, never green", () => {
    expect(classifyPulse(null, rules)).toBe("unknown");
    expect(classifySpo2(undefined, rules)).toBe("unknown");
    expect(classifyTemperature(Number.NaN, rules)).toBe("unknown");
  });
});

describe("device flags", () => {
  it("orders worst first and sends low oxygen to the breathlessness topic", () => {
    const f = deviceRedFlags({ pulse_bpm: 110, spo2_pct: 88, temperature_c: 38.4 }, rules);
    expect(f.map((x) => x.vital)).toEqual(["spo2_pct", "pulse_bpm", "temperature_c"]);
    expect(f[0]).toMatchObject({ level: "emergency", topic: "severe_breathlessness" });
  });
});

describe("symptom text", () => {
  it("maps danger phrases to a topic and still flags the rest", () => {
    expect(emergencyForText("I have chest pain since morning")).toEqual({ redFlag: true, topic: "chest_pain" });
    expect(emergencyForText("my father has slurred speech")).toEqual({ redFlag: true, topic: "stroke" });
    expect(emergencyForText("I took too many tablets")).toEqual({ redFlag: true, topic: null });
    expect(emergencyForText("a mild cough")).toEqual({ redFlag: false, topic: null });
  });
});

describe("the emergency pack", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it("loads and answers with no network at all (INV-06)", () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network used"); });
    const active = activeEmergencyPack(pack);
    expect(active.firstLine).toBe("Go to the nearest hospital now.");
    expect(emergencyFacilitiesForState(pack, "LA").noneListed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is a draft: no clinical topic card is shown until the CMO signs, only the first line and facilities", () => {
    expect(pack.status).toBe("draft");
    expect(pack.signed).toBeNull();
    const active = activeEmergencyPack(pack);
    expect(active.isDraft).toBe(true);
    expect(active.topics).toEqual([]);
    const signed = activeEmergencyPack({ ...pack, status: "signed", signed: { by: "Test CMO", on: "2026-10-08", version: 1 } });
    expect(signed.isDraft).toBe(false);
    expect(signed.topics.length).toBe(9);
  });

  it("carries no telephone number of any kind, and no 112, 767, 199 or 911 (CMO Q18)", () => {
    expect(findNumbersInPack(pack)).toEqual([]);
    expect(findNumbersInPack({ ...pack, first_line: "Call 112 now" })).not.toEqual([]);
    expect(findNumbersInPack({ ...pack, first_line: "Call +2348012345678" })).not.toEqual([]);
    expect(JSON.stringify(pack)).not.toMatch(/tel:|helpline|call the|dial/i);
  });

  it("has all nine topics, each telling the person to go to a hospital or why not to wait", () => {
    const signed = activeEmergencyPack({ ...pack, status: "signed", signed: { by: "t", on: "2026-10-08", version: 1 } });
    expect(signed.topics.map((t) => t.key).sort()).toEqual(
      ["chest_pain", "lassa_warning", "low_blood_sugar", "malaria_danger", "pregnancy_danger", "seizure", "severe_blood_pressure", "severe_breathlessness", "stroke"],
    );
    for (const t of signed.topics) expect(t.steps.length).toBeGreaterThan(0);
  });

  it("holds the Q17 content", () => {
    const signed = activeEmergencyPack({ ...pack, status: "signed", signed: { by: "t", on: "2026-10-08", version: 1 } });
    const text = (k: string) => JSON.stringify(topicByKey(signed, k)).toLowerCase();
    expect(text("chest_pain")).toContain("162 to 324 mg");
    expect(text("chest_pain")).toContain("not allergic");
    expect(text("chest_pain")).toContain("after you have asked for help");
    // stroke: never aspirin, and no step recommends it
    const stroke = topicByKey(signed, "stroke")!;
    expect(stroke.never.join(" ").toLowerCase()).toContain("never give aspirin");
    expect(stroke.steps.join(" ").toLowerCase()).not.toContain("aspirin");
    expect(text("low_blood_sugar")).toContain("15 g");
    expect(text("low_blood_sugar")).toContain("15 minutes");
    expect(text("low_blood_sugar")).toContain("nothing by mouth");
    expect(text("low_blood_sugar")).toContain("recovery position");
    expect(text("seizure")).toContain("5 minutes");
    expect(text("seizure")).toContain("anything in the mouth");
    expect(text("seizure")).toContain("recovery position");
    expect(text("pregnancy_danger")).toContain("160/110");
    expect(text("malaria_danger")).toContain("cannot drink");
    expect(text("malaria_danger")).toContain("drowsy");
  });

  it("covers every state: an emergency facility or an explicit none-listed row, and no fabricated facility", () => {
    expect(pack.states.length).toBe(37);
    expect(new Set(pack.states.map((s) => s.code)).size).toBe(37);
    for (const s of pack.states) {
      expect(s.none_listed).toBe(s.facilities.length === 0);
      for (const f of s.facilities) expect(f.last_verified_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // nothing is invented: until a person verifies a real hospital, every state says so
    expect(pack.states.every((s) => s.none_listed)).toBe(true);
    expect(emergencyFacilitiesForState(pack, "Zamfara")).toMatchObject({ state: "Zamfara", noneListed: true });
    expect(emergencyFacilitiesForState(pack, "nowhere")).toMatchObject({ noneListed: true });
  });

  it("a state with a verified facility shows it with its date", () => {
    const withOne: PackLike = {
      ...pack,
      states: pack.states.map((s) => (s.code === "LA" ? { ...s, none_listed: false, facilities: [{ name: "SAMPLE", address: "x", latitude: null, longitude: null, last_verified_on: "2026-10-01" }] } : s)),
    };
    const r = emergencyFacilitiesForState(withOne, "LA");
    expect(r.noneListed).toBe(false);
    expect(r.facilities[0]?.last_verified_on).toBe("2026-10-01");
  });

  it("uses no em dash", () => {
    expect(JSON.stringify(pack)).not.toContain("—");
  });

  it("needsHospitalNow is true for red and emergency, false for amber", () => {
    expect(needsHospitalNow(deviceRedFlags({ spo2_pct: 93 }, rules))).toBe(false);
    expect(needsHospitalNow(deviceRedFlags({ spo2_pct: 91 }, rules))).toBe(true);
    expect(needsHospitalNow(deviceRedFlags({ pulse_bpm: 160 }, rules))).toBe(true);
  });
});
