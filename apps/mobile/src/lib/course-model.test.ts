import { describe, expect, it } from "@jest/globals";
import {
  courseIsOpen,
  lessonDone,
  nextSpeed,
  paragraphs,
  parseLesson,
  pidginComing,
  summarise,
  type CourseRow,
} from "./course-model";

const row = (over: Partial<CourseRow> = {}): CourseRow => ({
  module_number: 1,
  content_id: "c1",
  audio_clip_id: "BPC-01",
  title: "T",
  summary: "S",
  body: "One.\n\nTwo.",
  next_action: "Do a thing today.",
  estimated_minutes: 3,
  knowledge_check: [{ question: "Q?", options: ["a", "b", "c"], answer_index: 1 }],
  language_served: "en",
  reviewed_by_name: null,
  reviewed_at: null,
  next_review_due: "2027-01-01",
  status: null,
  ...over,
});

describe("parseLesson", () => {
  it("reads the row, the one teach-back question and the action", () => {
    const l = parseLesson(row());
    expect(l.check).toEqual({ question: "Q?", options: ["a", "b", "c"], answer_index: 1 });
    expect(l.nextAction).toBe("Do a thing today.");
    expect(l.audioClipId).toBe("BPC-01");
    expect(l.languageServed).toBe("en");
  });

  it("degrades a malformed question to no question rather than throwing", () => {
    expect(parseLesson(row({ knowledge_check: [{ question: "", options: ["a"] }] })).check).toBeNull();
    expect(parseLesson(row({ knowledge_check: null })).check).toBeNull();
  });

  it("gives a reviewer credit only when there is both a name and a date", () => {
    expect(parseLesson(row({ reviewed_by_name: "Dr A", reviewed_at: "2026-10-01T00:00:00Z" })).reviewedByName).toBe("Dr A");
    expect(parseLesson(row({ reviewed_by_name: "Dr A", reviewed_at: null })).reviewedByName).toBeNull();
    expect(parseLesson(row({ reviewed_by_name: null, reviewed_at: "2026-10-01T00:00:00Z" })).reviewedByName).toBeNull();
    expect(parseLesson(row()).reviewedByName).toBeNull();
  });

  it("treats a blank action as none and an unknown status as not started", () => {
    expect(parseLesson(row({ next_action: "  " })).nextAction).toBeNull();
    expect(parseLesson(row({ status: "weird" })).status).toBeNull();
    expect(parseLesson(row({ status: "needs_review" })).status).toBe("needs_review");
  });
});

describe("progress", () => {
  const mk = (n: number, status: CourseRow["status"]) => parseLesson(row({ module_number: n, content_id: `c${n}`, status }));

  it("counts a lesson done only when its question was answered, not when it was opened", () => {
    expect(lessonDone(mk(1, "seen"))).toBe(false);
    expect(lessonDone(mk(1, null))).toBe(false);
    expect(lessonDone(mk(1, "understood"))).toBe(true);
    expect(lessonDone(mk(1, "needs_review"))).toBe(true);
  });

  it("finds the first lesson not done, in order, whatever order the rows arrive in", () => {
    const s = summarise([mk(3, null), mk(1, "understood"), mk(2, "seen")]);
    expect(s).toMatchObject({ total: 3, done: 1, finished: false });
    expect(s.next?.moduleNumber).toBe(2);
  });

  it("is finished when every lesson is done, and never finished when empty", () => {
    const all = summarise([mk(1, "understood"), mk(2, "needs_review")]);
    expect(all).toMatchObject({ finished: true, next: null, done: 2 });
    expect(summarise([])).toMatchObject({ total: 0, finished: false, next: null });
  });

  it("opens the course card only when the server returned lessons", () => {
    expect(courseIsOpen([])).toBe(false);
    expect(courseIsOpen([mk(1, null)])).toBe(true);
  });
});

describe("small helpers", () => {
  it("splits paragraphs on blank lines", () => {
    expect(paragraphs("a\n\nb\n\n\n c ")).toEqual(["a", "b", "c"]);
  });

  it("says Pidgin is coming only for a Pidgin speaker who is shown English", () => {
    expect(pidginComing("pcm", { languageServed: "en" })).toBe(true);
    expect(pidginComing("pcm", { languageServed: "pcm" })).toBe(false);
    expect(pidginComing("en", { languageServed: "en" })).toBe(false);
  });

  it("cycles playback speed and wraps", () => {
    expect(nextSpeed(0.75)).toBe(1);
    expect(nextSpeed(1)).toBe(1.25);
    expect(nextSpeed(1.25)).toBe(0.75);
  });
});
