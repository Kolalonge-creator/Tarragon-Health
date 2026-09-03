import { decideCycleReminder } from "./reminders";
import { addDays, predictCycle, type ObservedPeriod } from "@/lib/rules/cycle-prediction";

/** A regular history of `count` cycles, the last starting at `lastStart`. */
function regularPeriods(lastStart: string, count: number, cycleLength = 28): ObservedPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const startDate = addDays(lastStart, -cycleLength * (count - 1 - index));
    return { startDate, endDate: addDays(startDate, 4) };
  });
}

function predictionOn(today: string, periods = regularPeriods("2026-08-01", 7)) {
  return predictCycle({ periods, today, lifeStage: "menstruating" });
}

describe("decideCycleReminder", () => {
  // 7 periods 28 days apart from 2026-08-01 => next period 2026-08-29,
  // high confidence, a one-day window either side.
  it("sends a heads-up exactly two days before the expected date", () => {
    const reminder = decideCycleReminder(predictionOn("2026-08-27"), "menstruating");
    expect(reminder?.kind).toBe("period_due_soon");
    expect(reminder?.predictedDate).toBe("2026-08-29");
  });

  it("says nothing three days before, so the heads-up cannot fire twice", () => {
    expect(decideCycleReminder(predictionOn("2026-08-26"), "menstruating")).toBeNull();
  });

  it("sends a due-today reminder on the expected date", () => {
    const reminder = decideCycleReminder(predictionOn("2026-08-29"), "menstruating");
    expect(reminder?.kind).toBe("period_due_today");
  });

  it("stays quiet while still inside the predicted window", () => {
    // 2026-08-30 is one day past the estimate but inside the band.
    const prediction = predictionOn("2026-08-30");
    expect(prediction.isOverdue).toBe(false);
    expect(decideCycleReminder(prediction, "menstruating")).toBeNull();
  });

  it("sends one late reminder once the window has clearly passed", () => {
    const late = decideCycleReminder(predictionOn("2026-09-01"), "menstruating");
    expect(late?.kind).toBe("period_late");
    expect(late?.payload.days_overdue).toBe(3);
  });

  it("keeps offering the late reminder on later days too, for the cron to de-duplicate", () => {
    // A one-day-only window meant a single failed cron run dropped the
    // reminder for the whole cycle. Sending once is the dedupe key's job
    // (runCycleReminders), not this function's.
    for (const day of ["2026-09-02", "2026-09-05", "2026-09-20"]) {
      const reminder = decideCycleReminder(predictionOn(day), "menstruating");
      expect(reminder?.kind).toBe("period_late");
      // Anchored to the same predicted date every time, which is what makes
      // the dedupe key stable across those days.
      expect(reminder?.predictedDate).toBe("2026-08-29");
    }
  });

  it("does not send the late reminder before the threshold", () => {
    // 2026-08-31 is two days past the estimate: overdue, but not yet enough.
    const prediction = predictionOn("2026-08-31");
    expect(prediction.isOverdue).toBe(true);
    expect(decideCycleReminder(prediction, "menstruating")).toBeNull();
  });

  it("stays silent while the patient is bleeding", () => {
    const prediction = predictionOn("2026-08-02");
    expect(prediction.currentPhase).toBe("menstrual");
    expect(decideCycleReminder(prediction, "menstruating")).toBeNull();
  });

  it("stays silent when confidence is low or absent", () => {
    // Two cycles only => low confidence.
    const thin = predictCycle({
      periods: regularPeriods("2026-08-01", 3),
      today: "2026-08-27",
      lifeStage: "menstruating",
    });
    expect(thin.confidence).toBe("low");
    expect(decideCycleReminder(thin, "menstruating")).toBeNull();

    const none = predictCycle({ periods: [], today: "2026-08-27", lifeStage: "menstruating" });
    expect(decideCycleReminder(none, "menstruating")).toBeNull();
  });

  it("stays silent when cycles are too variable to predict confidently", () => {
    const variable: ObservedPeriod[] = [{ startDate: "2026-01-01", endDate: "2026-01-05" }];
    for (const length of [24, 36, 26, 38, 27]) {
      const previous = variable[variable.length - 1].startDate;
      const startDate = addDays(previous, length);
      variable.push({ startDate, endDate: addDays(startDate, 4) });
    }
    const prediction = predictCycle({
      periods: variable,
      today: "2026-06-01",
      lifeStage: "menstruating",
    });
    expect(prediction.confidence).toBe("low");
    expect(decideCycleReminder(prediction, "menstruating")).toBeNull();
  });

  it("never reminds somebody who is pregnant, postpartum or menopausal", () => {
    const prediction = predictionOn("2026-08-27");
    for (const stage of ["pregnant", "postpartum", "menopausal", "perimenopausal", "not_applicable"]) {
      expect(decideCycleReminder(prediction, stage)).toBeNull();
    }
  });

  it("does remind somebody who is trying to conceive", () => {
    const reminder = decideCycleReminder(predictionOn("2026-08-27"), "trying_to_conceive");
    expect(reminder?.kind).toBe("period_due_soon");
  });

  it("anchors every reminder to the predicted date so it can be de-duplicated", () => {
    const soon = decideCycleReminder(predictionOn("2026-08-27"), "menstruating");
    const today = decideCycleReminder(predictionOn("2026-08-29"), "menstruating");
    expect(soon?.predictedDate).toBe("2026-08-29");
    expect(today?.predictedDate).toBe("2026-08-29");
    expect(soon?.payload.expected_date).toBe("2026-08-29");
  });
});
