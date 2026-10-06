import { describe, expect, it } from "@jest/globals";
import { BPC_LESSONS, BPC_PROGRAMME, type LessonText } from "./bpc-course";

/** Understandability gate 1 (docs/design/S33.md section 8): an automatic lint on every lesson. */
const WORDS_PER_MINUTE = 130;
// A calm recording with pauses after each idea runs slower than plain speech; planned lengths assume this pace.
const RECORDED_WORDS_PER_MINUTE = 100;
const MAX_MINUTES = 5;
const MAX_SENTENCE_WORDS = 28;
const MAX_AVG_SENTENCE_WORDS = 17;
const MAX_FK_GRADE = 8.5;

const BANNED = [/\bcures?\b/i, /\bcured\b/i, /instant doctor/i, /free healthcare/i, /your doctor/i, /\bdoctor\b/i, /—/, /silent killer/i, /mmhg/i, /\b\d{2,3}\s*\/\s*\d{2,3}\b/];
// A medicine name, a dose or a herb claim must come from a signed wording, never from a build session.
const MEDICINE_NAMES =
  /\b(amlodipine|lisinopril|losartan|telmisartan|valsartan|hydrochlorothiazide|indapamide|atenolol|bisoprolol|nifedipine|ramipril|enalapril|furosemide|metoprolol|carvedilol|spironolactone|aspirin|paracetamol|ibuprofen)\b/i;
const DOSE = /\b\d+\s*(mg|mcg|ml|tablets?|pills?)\b/i;
const HERB_CLAIM = /\b(lowers?|reduces?|controls?|treats?)\b[^.]{0,40}\b(bitter kola|garlic|ginger|zobo|hibiscus|bitter leaf)\b/i;

const wordsOf = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const sentencesOf = (s: string): string[] => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0);

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function fkGrade(text: string): number {
  const sentences = sentencesOf(text);
  const words = wordsOf(text);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
}

const lessonTexts = (): { code: string; lang: "en" | "pcm"; text: LessonText }[] =>
  BPC_LESSONS.flatMap((l) => [
    { code: l.code, lang: "en" as const, text: l.en },
    ...(l.pcm ? [{ code: l.code, lang: "pcm" as const, text: l.pcm }] : []),
  ]);

const fullText = (t: LessonText): string =>
  [t.title, t.summary, t.body, t.nextAction, t.check.question, ...t.check.options].join("\n");

/** Pidgin for these lessons is written (needs native review). The rest are held in English (OQ-19, OQ-87). */
const PIDGIN_WRITTEN = ["BPC-01", "BPC-07", "BPC-08", "BPC-09", "BPC-10", "BPC-11", "BPC-14"];

describe("BPC course source", () => {
  it("has the fourteen Release 1 lessons in order, none for the Release 3 pregnancy lesson", () => {
    expect(BPC_LESSONS.map((l) => l.code)).toEqual(Array.from({ length: 14 }, (_, i) => `BPC-${String(i + 1).padStart(2, "0")}`));
    expect(new Set(BPC_LESSONS.map((l) => l.slug)).size).toBe(14);
    expect(BPC_LESSONS.some((l) => l.code === "BPC-15")).toBe(false);
    expect(BPC_PROGRAMME.code).toBe("bp_care_course");
  });

  it("keeps every lesson under five minutes at a spoken pace, near its planned length", () => {
    const problems: string[] = [];
    for (const l of BPC_LESSONS) {
      const words = wordsOf(l.en.body).length;
      const recorded = words / RECORDED_WORDS_PER_MINUTE;
      if (words / WORDS_PER_MINUTE > MAX_MINUTES || recorded > MAX_MINUTES) problems.push(`${l.code}: ${recorded.toFixed(1)} min recorded is over ${MAX_MINUTES}`);
      // The production list plans 3 to 4 minutes; a lesson far shorter or longer would mis-set the audio budget.
      if (Math.abs(recorded - l.briefMinutes) > 1.6) problems.push(`${l.code}: ${recorded.toFixed(1)} min recorded vs planned ${l.briefMinutes}`);
    }
    expect(problems).toEqual([]);
  });

  it("uses short sentences and a plain reading level in English", () => {
    const problems: string[] = [];
    for (const l of BPC_LESSONS) {
      const sentences = sentencesOf(l.en.body);
      const longest = sentences.reduce((a, s) => (wordsOf(s).length > wordsOf(a).length ? s : a), "");
      const avg = wordsOf(l.en.body).length / sentences.length;
      if (wordsOf(longest).length > MAX_SENTENCE_WORDS) problems.push(`${l.code}: sentence of ${wordsOf(longest).length} words: ${longest.slice(0, 60)}`);
      if (avg > MAX_AVG_SENTENCE_WORDS) problems.push(`${l.code}: average ${avg.toFixed(1)} words a sentence`);
      if (fkGrade(l.en.body) > MAX_FK_GRADE) problems.push(`${l.code}: grade ${fkGrade(l.en.body).toFixed(1)}`);
    }
    expect(problems).toEqual([]);
  });

  it("contains no banned word, mmHg figure, medicine name, dose or herb claim, in either language", () => {
    for (const { code, lang, text } of lessonTexts()) {
      const s = fullText(text);
      for (const re of BANNED) expect([code, lang, String(re), re.test(s)]).toEqual([code, lang, String(re), false]);
      expect([code, lang, "medicine", MEDICINE_NAMES.test(s)]).toEqual([code, lang, "medicine", false]);
      expect([code, lang, "dose", DOSE.test(s)]).toEqual([code, lang, "dose", false]);
      expect([code, lang, "herb", HERB_CLAIM.test(s)]).toEqual([code, lang, "herb", false]);
    }
  });

  it("ends every lesson with one action and one teach-back question", () => {
    for (const { code, lang, text } of lessonTexts()) {
      expect([code, lang, wordsOf(text.nextAction).length >= 5 && wordsOf(text.nextAction).length <= 40]).toEqual([code, lang, true]);
      expect(text.check.options).toHaveLength(3);
      expect(new Set(text.check.options).size).toBe(3);
      expect([0, 1, 2]).toContain(text.check.answerIndex);
      expect(text.check.question.endsWith("?")).toBe(true);
      expect(text.summary.length).toBeGreaterThan(10);
    }
  });

  it("writes Pidgin only for the planned lessons and holds the rest in English with a reason", () => {
    expect(BPC_LESSONS.filter((l) => l.pcm).map((l) => l.code)).toEqual(PIDGIN_WRITTEN);
    for (const l of BPC_LESSONS) {
      if (l.pcm) {
        expect(l.pcmHeldBecause).toBeUndefined();
      } else {
        expect([l.code, (l.pcmHeldBecause ?? "").length > 10]).toEqual([l.code, true]);
      }
    }
  });

  it("keeps each Pidgin lesson the same shape and meaning anchors as its English source", () => {
    for (const l of BPC_LESSONS) {
      if (!l.pcm) continue;
      expect([l.code, l.pcm.body.split("\n\n").length]).toEqual([l.code, l.en.body.split("\n\n").length]);
      expect(l.pcm.check.answerIndex).toBe(l.en.check.answerIndex);
      // The care team reference and the emergency route must survive translation.
      expect(/care team/i.test(l.pcm.body)).toBe(true);
    }
  });

  it("routes the warning-signs lesson to emergency care and never tells the learner to wait", () => {
    const l = BPC_LESSONS.find((x) => x.code === "BPC-13");
    expect(l).toBeDefined();
    expect(l?.en.body).toMatch(/112/);
    expect(l?.en.body).toMatch(/emergency/i);
    expect(l?.en.body).toMatch(/Do not wait/);
  });

  it("never presents breathing as a treatment, and keeps medicines and readings in the same breath", () => {
    const l = BPC_LESSONS.find((x) => x.code === "BPC-11");
    expect(l?.en.body).toMatch(/does not replace your tablets/);
    expect(l?.en.body).not.toMatch(/lower(s)? your blood pressure/);
  });
});
