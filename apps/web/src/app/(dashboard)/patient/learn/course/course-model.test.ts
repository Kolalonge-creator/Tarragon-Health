import { describe, expect, it } from "@jest/globals";
import { lessonDone, paragraphs, parseLesson, summarise, type CourseRow } from "./course-model";

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

describe("web course model", () => {
  it("reads the lesson, the one question and the action", () => {
    const l = parseLesson(row());
    expect(l.check?.question).toBe("Q?");
    expect(l.nextAction).toBe("Do a thing today.");
  });

  it("gives a reviewer credit only from a complete record", () => {
    expect(parseLesson(row({ reviewed_by_name: "Dr A", reviewed_at: "2026-10-01T00:00:00Z" })).reviewedByName).toBe("Dr A");
    expect(parseLesson(row({ reviewed_by_name: "Dr A" })).reviewedByName).toBeNull();
    expect(parseLesson(row({ reviewed_at: "2026-10-01T00:00:00Z" })).reviewedByName).toBeNull();
  });

  it("counts a lesson done only when its question was answered", () => {
    expect(lessonDone({ status: "seen" })).toBe(false);
    expect(lessonDone({ status: null })).toBe(false);
    expect(lessonDone({ status: "understood" })).toBe(true);
    expect(lessonDone({ status: "needs_review" })).toBe(true);
  });

  it("finds the next lesson and knows when the course is finished, never when empty", () => {
    const mk = (n: number, status: CourseRow["status"]) => parseLesson(row({ module_number: n, content_id: `c${n}`, status }));
    expect(summarise([mk(3, null), mk(1, "understood"), mk(2, "seen")]).next?.moduleNumber).toBe(2);
    expect(summarise([mk(1, "understood"), mk(2, "needs_review")]).finished).toBe(true);
    expect(summarise([]).finished).toBe(false);
  });

  it("splits paragraphs", () => {
    expect(paragraphs("a\n\nb\n\n\n c ")).toEqual(["a", "b", "c"]);
  });
});
