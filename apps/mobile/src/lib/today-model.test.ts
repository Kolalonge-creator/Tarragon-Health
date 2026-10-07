import { en } from "@tarragon/i18n";
import type { DoseChecklistItem } from "./medications";
import { lagosTimeToUtcMs } from "./lagos-date";
import { buildTodayList, toTodayTasks, type TodayTask } from "./today-model";

const TODAY = "2026-10-04";
const NOW = lagosTimeToUtcMs(TODAY, "10:00") as number; // 10:00 Lagos
const at = (date: string, time = "08:00") => new Date(lagosTimeToUtcMs(date, time) as number).toISOString();

const task = (over: Partial<TodayTask> = {}): TodayTask => ({
  id: "t1",
  kind: "log_bp",
  title: "Record BP",
  priority: 2,
  dueAt: at(TODAY, "15:00"),
  recurrence: null,
  state: "open",
  updatedAt: at("2026-10-01"),
  ...over,
});
const dose = (over: Partial<DoseChecklistItem> = {}): DoseChecklistItem => ({
  medicationId: "m1",
  drugName: "Amlodipine",
  time: "08:00",
  status: "pending",
  ...over,
});
const build = (over: Partial<Parameters<typeof buildTodayList>[0]> = {}) =>
  buildTodayList({ nowMs: NOW, tasks: [], doses: [], bpLoggedToday: false, ...over });

describe("what is shown", () => {
  it("is empty with nothing to do", () => {
    expect(build()).toEqual({ open: [], shownOpen: [], moreCount: 0, done: [], total: 0 });
  });

  it("shows open tasks and drops closed, cancelled, missed and unable ones (no shame state)", () => {
    const out = build({
      tasks: [
        task({ id: "a" }),
        task({ id: "b", state: "missed" }),
        task({ id: "c", state: "unable" }),
        task({ id: "d", state: "cancelled" }),
      ],
    });
    expect(out.open.map((i) => i.id)).toEqual(["task:a"]);
    expect(out.done).toEqual([]);
  });

  it("shows a task done today as done, and one done on an earlier day not at all", () => {
    const out = build({
      tasks: [
        task({ id: "a", state: "done", updatedAt: at(TODAY, "07:00") }),
        task({ id: "b", state: "done", updatedAt: at("2026-10-03") }),
      ],
    });
    expect(out.done.map((i) => i.id)).toEqual(["task:a"]);
    expect(out.open).toEqual([]);
  });

  it("uses the Lagos day, so a task finished at 00:30 Lagos counts as today", () => {
    const justAfterMidnight = Date.parse("2026-10-03T23:30:00Z"); // 00:30 on 2026-10-04 Lagos
    const out = buildTodayList({
      nowMs: justAfterMidnight + 3_600_000,
      tasks: [task({ state: "done", updatedAt: new Date(justAfterMidnight).toISOString() })],
      doses: [],
      bpLoggedToday: false,
    });
    expect(out.done).toHaveLength(1);
  });

  it("falls back to a translatable title when the task has no text", () => {
    const out = build({ tasks: [task({ title: "   ", kind: "book_test" })] });
    expect(out.open[0]?.title).toEqual({ line: { key: "today.kind.book_test" } });
  });

  it("treats an unknown kind as a task from the care team that opens the Care section, where tasks are listed", () => {
    const out = build({ tasks: [task({ kind: "something_new", title: "" })] });
    expect(out.open[0]).toMatchObject({ kind: "other", target: "care", title: { line: { key: "today.kind.other" } } });
  });
});

describe("where an item goes", () => {
  it.each([
    ["log_bp", "vitals"],
    ["book_test", "labs"],
    ["join_consultation", "appointments"],
    ["read_lesson", "learn"],
  ])("a %s task opens %s", (kind, target) => {
    expect(build({ tasks: [task({ kind })] }).open[0]?.target).toBe(target);
  });

  it("a dose opens Medications", () => {
    expect(build({ doses: [dose()] }).open[0]?.target).toBe("medications");
  });
});

describe("medicines", () => {
  it("come only from dose slots: a stored take_medicine task is hidden so nothing appears twice", () => {
    const out = build({ tasks: [task({ kind: "take_medicine" })], doses: [dose()] });
    expect(out.open).toHaveLength(1);
    expect(out.open[0]?.source).toBe("dose");
  });

  it("lists a pending slot, shows a taken one as done, and does not list skipped or missed slots", () => {
    const out = build({
      doses: [
        dose({ time: "20:00" }),
        dose({ medicationId: "m2", status: "taken" }),
        dose({ medicationId: "m3", status: "skipped" }),
        dose({ medicationId: "m4", status: "missed" }),
      ],
    });
    expect(out.open.map((i) => i.id)).toEqual(["dose:m1:20:00"]);
    expect(out.done.map((i) => i.id)).toEqual(["dose:m2:08:00"]);
  });

  it("says 'earlier today' for a slot whose time has passed, never 'late'", () => {
    const out = build({ doses: [dose({ time: "08:00" }), dose({ medicationId: "m2", time: "20:00" })] });
    const byId = Object.fromEntries(out.open.map((i) => [i.id, i.due]));
    expect(byId["dose:m1:08:00"]).toEqual({ key: "today.due.earlier", params: { time: "08:00" } });
    expect(byId["dose:m2:20:00"]).toEqual({ key: "today.due.at", params: { time: "20:00" } });
    expect(out.open.every((i) => i.status === "due")).toBe(true);
  });

  it("reads a stored time that carries seconds (08:00:00) as 08:00", () => {
    const out = build({ doses: [dose({ time: "08:00:00" }), dose({ medicationId: "m2", time: "20:00:00" })] });
    const byId = Object.fromEntries(out.open.map((i) => [i.id, i]));
    expect(byId["dose:m1:08:00"]?.due).toEqual({ key: "today.due.earlier", params: { time: "08:00" } });
    expect(byId["dose:m2:20:00"]?.due).toEqual({ key: "today.due.at", params: { time: "20:00" } });
    expect(byId["dose:m2:20:00"]?.dueAtMs).toBe(lagosTimeToUtcMs(TODAY, "20:00"));
  });

  it("names the drug in the title line", () => {
    expect(build({ doses: [dose({ drugName: "Metformin" })] }).open[0]?.title).toEqual({
      line: { key: "today.dose", params: { drug: "Metformin" } },
    });
  });
});

describe("due wording", () => {
  const due = (dueAt: string | null) => build({ tasks: [task({ dueAt })] }).open[0];

  it("is overdue only once the Lagos day has passed, not when the clock time has", () => {
    expect(due(at(TODAY, "07:00"))).toMatchObject({ status: "due", due: { key: "today.due.today" } });
    expect(due(at("2026-10-03", "23:00"))).toMatchObject({ status: "overdue", due: { key: "today.due.overdue" } });
  });

  it("says tomorrow, in N days, or no date", () => {
    expect(due(at("2026-10-05"))?.due).toEqual({ key: "today.due.tomorrow" });
    expect(due(at("2026-10-09"))?.due).toEqual({ key: "today.due.in_days", params: { days: 5 } });
    expect(due(null)?.due).toEqual({ key: "today.due.anytime" });
  });

  it("treats an unreadable due date as no date", () => {
    expect(due("not a date")?.due).toEqual({ key: "today.due.anytime" });
  });
});

describe("a blood pressure task and a reading logged today", () => {
  it("counts as done for a once-off or daily task", () => {
    for (const recurrence of [null, "daily"]) {
      const out = build({ tasks: [task({ recurrence })], bpLoggedToday: true });
      expect(out.open).toEqual([]);
      expect(out.done[0]).toMatchObject({ status: "done", due: { key: "today.due.logged" } });
    }
  });

  it("does not finish a weekly or monthly task (one reading is not three a week)", () => {
    for (const recurrence of ["weekly", "monthly"]) {
      expect(build({ tasks: [task({ recurrence })], bpLoggedToday: true }).open).toHaveLength(1);
    }
  });

  it("does not change other kinds of task", () => {
    expect(build({ tasks: [task({ kind: "book_test" })], bpLoggedToday: true }).open).toHaveLength(1);
  });

  it("stays open when no reading was logged", () => {
    expect(build({ tasks: [task()], bpLoggedToday: false }).open).toHaveLength(1);
  });
});

describe("order and limits", () => {
  it("puts overdue first, then today by time, then later days, then no date; priority breaks ties", () => {
    const out = build({
      tasks: [
        task({ id: "nodate", dueAt: null }),
        task({ id: "later", dueAt: at("2026-10-07") }),
        task({ id: "a-low", dueAt: at(TODAY, "15:00"), priority: 3 }),
        task({ id: "z-high", dueAt: at(TODAY, "15:00"), priority: 1 }),
        task({ id: "overdue", dueAt: at("2026-10-01") }),
      ],
      doses: [dose({ time: "18:00" })],
    });
    expect(out.open.map((i) => i.id)).toEqual([
      "task:overdue",
      "task:z-high",
      "task:a-low",
      "dose:m1:18:00",
      "task:later",
      "task:nodate",
    ]);
  });

  it("shows only the first few and counts the rest", () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, dueAt: at(TODAY, "15:00") }));
    const out = build({ tasks, maxOpen: 5 });
    expect(out.shownOpen).toHaveLength(5);
    expect(out.moreCount).toBe(3);
    expect(out.total).toBe(8);
  });

  it("counts done items in the total", () => {
    const out = build({ tasks: [task({ id: "a" })], doses: [dose({ status: "taken" })] });
    expect(out).toMatchObject({ total: 2 });
    expect(out.done).toHaveLength(1);
  });

  it("never orders by anything about how the patient is doing", () => {
    // Two tasks identical but for state of health claims in the title: order is by due date and id only.
    const out = build({ tasks: [task({ id: "b", title: "BP very high" }), task({ id: "a", title: "BP fine" })] });
    expect(out.open.map((i) => i.id)).toEqual(["task:a", "task:b"]);
  });
});

describe("toTodayTasks", () => {
  it("maps view rows and drops rows with no id or state", () => {
    const out = toTodayTasks([
      { id: "1", kind: "log_bp", title: "x", priority: 1, due_at: "2026-10-04T10:00:00Z", recurrence: null, state: "open", updated_at: null },
      { id: null, state: "open" },
      { id: "3", state: null },
      { id: "4", state: "done" },
    ]);
    expect(out.map((t) => t.id)).toEqual(["1", "4"]);
    expect(out[1]).toMatchObject({ kind: null, title: "", priority: null, dueAt: null });
  });
});

describe("every translation key the model can return exists in English", () => {
  const keys = new Set<string>();
  const collect = (l: { key: string }) => keys.add(l.key);
  const out = build({
    tasks: [
      task({ id: "1", title: "", kind: "log_bp" }),
      task({ id: "2", title: "", kind: "take_medicine" }),
      task({ id: "3", title: "", kind: "book_test", dueAt: at("2026-10-01") }),
      task({ id: "4", title: "", kind: "join_consultation", dueAt: at("2026-10-05") }),
      task({ id: "5", title: "", kind: "read_lesson", dueAt: at("2026-10-09") }),
      task({ id: "6", title: "", kind: null, dueAt: null }),
      task({ id: "7", state: "done", updatedAt: at(TODAY, "07:00") }),
      task({ id: "8", recurrence: "daily" }),
    ],
    doses: [dose(), dose({ medicationId: "m2", time: "20:00" }), dose({ medicationId: "m3", status: "taken" })],
    bpLoggedToday: true,
    maxOpen: 99,
  });
  for (const i of [...out.open, ...out.done]) {
    collect(i.due);
    if ("line" in i.title) collect(i.title.line);
  }
  it.each([...keys])("%s", (key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
  });
});

describe("the repeat-reading prompt from triage (S12)", () => {
  it("shows its own translated line, not the daily log line, when the task has no title", () => {
    const out = build({ tasks: [task({ id: "r", title: "", source: "triage_recheck", dueAt: at(TODAY, "10:05") })] });
    expect(out.open[0]?.title).toEqual({ line: { key: "today.recheck_bp" } });
    expect(en["today.recheck_bp"]).toBe("Measure your blood pressure again");
  });

  it("an untitled task from anywhere else keeps the kind line, and a titled triage task keeps its title", () => {
    expect(build({ tasks: [task({ title: "", source: "clinician" })] }).open[0]?.title).toEqual({ line: { key: "today.kind.log_bp" } });
    expect(build({ tasks: [task({ title: "Care team note", source: "triage_recheck" })] }).open[0]?.title).toEqual({ text: "Care team note" });
  });

  it("carries source through from the view rows", () => {
    expect(toTodayTasks([{ id: "x", state: "open", source: "triage_recheck" }])[0]?.source).toBe("triage_recheck");
    expect(toTodayTasks([{ id: "x", state: "open" }])[0]?.source).toBeNull();
  });
});
