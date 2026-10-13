/**
 * Scoring for the understandability test of a lesson (docs/research/s33-understandability/README.md). Pure and import-free so
 * the command line scorer can load it directly. No participant identity is needed beyond a code the moderator assigns.
 *
 * The pass rule is a PROPOSED value (`learning.understandability_pass_rule`, owner CMO); this module takes it as an argument
 * and holds no default, so a number can never be quietly assumed. No lesson is shown to a patient on the strength of this score:
 * it informs the CMO's review, it does not replace it.
 */
export interface PassRule {
  readonly minParticipants: number;
  /** Share (0 to 1) who must give the main message AND name the action. */
  readonly minRecall: number;
  /** Misunderstandings of something unsafe a lesson may cause before it fails. */
  readonly maxUnsafe: number;
}

export interface SessionRow {
  readonly participant: string;
  readonly lesson: string;
  readonly recalledMessage: boolean;
  readonly namedAction: boolean;
  readonly unsafeMisunderstanding: boolean;
  readonly interviewerRead: boolean;
}

export type Verdict = "pass" | "fail" | "too_few";

export interface LessonScore {
  readonly lesson: string;
  readonly participants: number;
  readonly recalledMessage: number;
  readonly namedAction: number;
  readonly both: number;
  readonly unsafe: number;
  readonly interviewerRead: number;
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
}

export function scoreLessons(rows: readonly SessionRow[], rule: PassRule): LessonScore[] {
  // One row per participant per lesson: if a row is entered twice the last one wins, so a repeat can never
  // raise a count above the number of people tested.
  const latest = new Map<string, SessionRow>();
  for (const r of rows) latest.set(`${r.lesson}\u0000${r.participant}`, r);
  const groups = new Map<string, SessionRow[]>();
  for (const r of latest.values()) {
    groups.set(r.lesson, [...(groups.get(r.lesson) ?? []), r]);
  }
  const out: LessonScore[] = [];
  for (const [lesson, g] of groups) {
    const participants = new Set(g.map((r) => r.participant)).size;
    const count = (f: (r: SessionRow) => boolean) => g.filter(f).length;
    const both = count((r) => r.recalledMessage && r.namedAction);
    const unsafe = count((r) => r.unsafeMisunderstanding);
    const reasons: string[] = [];
    let verdict: Verdict = "pass";
    // An unsafe misunderstanding fails the lesson however few people were tested: it needs a rewrite and a retest.
    if (unsafe > rule.maxUnsafe) {
      verdict = "fail";
      reasons.push(`${unsafe} unsafe misunderstanding(s); at most ${rule.maxUnsafe} allowed`);
    }
    if (participants < rule.minParticipants) {
      if (verdict === "pass") verdict = "too_few";
      reasons.push(`${participants} participants; at least ${rule.minParticipants} needed`);
    }
    if (participants > 0 && both / participants < rule.minRecall) {
      verdict = "fail";
      reasons.push(`${Math.round((both / participants) * 100)} percent gave the message and the action; at least ${Math.round(rule.minRecall * 100)} needed`);
    }
    out.push({
      lesson,
      participants,
      recalledMessage: count((r) => r.recalledMessage),
      namedAction: count((r) => r.namedAction),
      both,
      unsafe,
      interviewerRead: count((r) => r.interviewerRead),
      verdict,
      reasons,
    });
  }
  return out.sort((a, b) => a.lesson.localeCompare(b.lesson));
}

/** Percent of applicable items answered yes (PEMAT and the CDC Clear Communication Index both score this way). */
export function percentScore(answers: readonly (boolean | null)[]): number | null {
  const applicable = answers.filter((a): a is boolean => a !== null);
  if (applicable.length === 0) return null;
  return Math.round((applicable.filter(Boolean).length / applicable.length) * 100);
}

const yes = (v: string): boolean => /^(y|yes|1|true)$/i.test(v.trim());

/** Reads the session sheet (`participant-session-sheet.csv`). Header names are matched case-insensitively. */
export function parseSessionCsv(text: string): SessionRow[] {
  // Split into records honouring quotes, so a quoted note with a line break stays in one record.
  const lines: string[] = [];
  {
    let cur = "";
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') q = !q;
      if ((c === "\n" || c === "\r") && !q) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (cur.trim() !== "" && !cur.startsWith("#")) lines.push(cur);
        cur = "";
      } else cur += c;
    }
    if (cur.trim() !== "" && !cur.startsWith("#")) lines.push(cur);
  }
  if (lines.length === 0) return [];
  const split = (l: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (q && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (c === "," && !q) {
        cells.push(cur);
        cur = "";
      } else cur += c;
    }
    cells.push(cur);
    return cells;
  };
  const head = split(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string): number => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`session sheet is missing the column "${name}"`);
    return i;
  };
  const ix = {
    participant: col("participant"),
    lesson: col("lesson"),
    recalled: col("recalled_message"),
    action: col("named_action"),
    unsafe: col("unsafe_misunderstanding"),
    read: col("interviewer_read"),
  };
  return lines.slice(1).map((l) => {
    const c = split(l);
    return {
      participant: c[ix.participant]?.trim() ?? "",
      lesson: c[ix.lesson]?.trim() ?? "",
      recalledMessage: yes(c[ix.recalled] ?? ""),
      namedAction: yes(c[ix.action] ?? ""),
      unsafeMisunderstanding: yes(c[ix.unsafe] ?? ""),
      interviewerRead: yes(c[ix.read] ?? ""),
    };
  });
}
