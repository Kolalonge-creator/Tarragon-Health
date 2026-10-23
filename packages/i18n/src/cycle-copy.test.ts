import { describe, expect, it } from "@jest/globals";
import { CYCLE_COPY_REVIEW, cycleCopy } from "./cycle-copy";
import { en } from "./en";

const keys = Object.keys(cycleCopy) as (keyof typeof cycleCopy)[];

describe("cycle copy (S66)", () => {
  it("is part of the English catalogue and every key is under a reviewed prefix", () => {
    for (const k of keys) {
      expect(en[k]).toBe(cycleCopy[k]);
      expect(CYCLE_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
    }
  });

  it("is marked pending CMO review and nothing in code says otherwise", () => {
    expect(CYCLE_COPY_REVIEW.status).toBe("pending_cmo_review");
    expect(CYCLE_COPY_REVIEW.owner).toBe("CMO");
  });

  it("the not-contraception label is on every string that states or explains a window", () => {
    expect(cycleCopy["cycle.not_contraception"]).toBe("This is not contraception.");
    expect(cycleCopy["cycle.planning.estimate_line"]).toContain(cycleCopy["cycle.not_contraception"]);
    expect(cycleCopy["cycle.planning.disclaimer"].startsWith(cycleCopy["cycle.not_contraception"])).toBe(true);
    expect(cycleCopy["cycle.planning.estimate_line"].toLowerCase()).toContain("estimate");
  });

  it("copy audit: nothing suggests avoiding a pregnancy by tracking, and no rank, dose or fertility-awareness-as-contraception on the contraception page", () => {
    const planning = keys.filter((k) => k.startsWith("cycle.")).map((k) => cycleCopy[k]);
    for (const text of planning) {
      expect(/safe days?|safe period|avoid (a )?pregnan|natural (family planning|birth control)|rhythm method|prevent(s|ing)? (a )?pregnan(?!cy and)/i.test(text.replace("It cannot prevent a pregnancy", ""))).toBe(false);
    }
    const edu = keys.filter((k) => k.startsWith("contraception.")).map((k) => cycleCopy[k]).join(" ");
    expect(/\b\d+\s?(mg|mcg|ml|tablets?|pills? a day)\b/i.test(edu)).toBe(false); // no dosing
    expect(/\b(best|most effective|safest|first choice|recommended|top)\b/i.test(edu)).toBe(false); // no ranking or recommendation
    expect(/fertility awareness|rhythm|calendar method|withdrawal|natural family/i.test(edu)).toBe(false);
    expect(cycleCopy["contraception.edu.not_tracking"]).toContain("not contraception");
  });

  it("lists the contraception methods in alphabetical order so the order cannot read as a ranking", () => {
    const methods = keys.filter((k) => k.startsWith("contraception.edu.method.")).map((k) => cycleCopy[k].split(":")[0] as string);
    const sorted = [...methods].sort((a, b) => a.localeCompare(b));
    expect(methods).toEqual(sorted);
  });

  it("says your care team, never your doctor, and keeps the danger signs free of personal data and of phone numbers", () => {
    for (const k of keys) {
      expect(/your doctor/i.test(cycleCopy[k])).toBe(false);
      expect(/—/.test(cycleCopy[k])).toBe(false);
    }
    for (const k of keys.filter((x) => x.startsWith("cycle.danger."))) expect(/\d{3,}/.test(cycleCopy[k])).toBe(false);
  });

  it("menopause copy gives a log and education only: no score, no hormone treatment advice, an urgent prompt for bleeding after the menopause", () => {
    const text = keys.filter((k) => k.startsWith("menopause.")).map((k) => cycleCopy[k]).join(" ").replace("not a score", "");
    expect(/score|HRT|hormone replacement|take estrogen|oestrogen/i.test(text)).toBe(false);
    expect(cycleCopy["menopause.education_3"]).toContain("does not give advice about hormone treatment");
    expect(cycleCopy["menopause.bleeding_urgent"]).toMatch(/always needs to be checked/);
  });
  it("UI-A strings: no exclamation marks, no shouting words, every fertile-window string says it is not contraception, and the offline claim is two sentences", () => {
    const ui = keys.filter((k) => /^cycle\.(status|confidence|log|flow|symptom|mood|ovulation_test|legend|offline|listen|danger\.(noticed|meaning|step|message))/.test(k));
    expect(ui.length).toBeGreaterThan(50);
    for (const k of ui) {
      expect(cycleCopy[k]).not.toMatch(/!/);
      expect(cycleCopy[k]).not.toMatch(/warning|urgent|alarm/i);
    }
    for (const k of ["cycle.legend.fertile", "cycle.legend.ovulation"] as const) expect(cycleCopy[k]).toContain(cycleCopy["cycle.not_contraception"]);
    expect(cycleCopy["cycle.offline.saved"]).toBe("Saved on this phone. It will send when you are online.");
  });

  it("every flow, symptom, mood and ovulation-test option the log can send has a label", () => {
    const need = [
      ...["none", "spotting", "light", "medium", "heavy", "flooding"].map((v) => `cycle.flow.${v}`),
      ...["cramps", "headache", "bloating", "breast_tenderness", "back_pain", "fatigue", "nausea", "acne", "diarrhoea", "constipation", "food_cravings", "insomnia"].map((v) => `cycle.symptom.${v}`),
      ...["calm", "happy", "energetic", "irritable", "anxious", "low", "mood_swings"].map((v) => `cycle.mood.${v}`),
      ...["negative", "positive", "peak"].map((v) => `cycle.ovulation_test.${v}`),
    ];
    for (const k of need) expect(k in cycleCopy).toBe(true);
  });
});
