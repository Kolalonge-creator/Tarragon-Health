import { en, pcm } from "@tarragon/i18n";
import { agoLine, dueLine, heroMetric, nextBestStep, type Line } from "./home-model";
import type { SummaryStats } from "./overview";

const base: SummaryStats = {
  latestBp: null,
  latestGlucoseMmolL: null,
  activeMedicationCount: 0,
  dosesTaken: 0,
  dosesTotal: 0,
  lastVitalTakenAt: null,
  hasRiskAssessment: false,
};
const TODAY = "2026-10-03";

describe("nextBestStep", () => {
  it("puts open doses first, singular and plural", () => {
    expect(nextBestStep({ ...base, dosesTotal: 2, dosesTaken: 1 }, TODAY).title.key).toBe("home.next.doses_one");
    const many = nextBestStep({ ...base, dosesTotal: 4, dosesTaken: 1 }, TODAY);
    expect(many.title).toEqual({ key: "home.next.doses_many", params: { count: 3 } });
    expect(many.target).toBe("medications");
  });

  it("asks for a reading when none was taken today (Lagos day), even late at night UTC", () => {
    expect(nextBestStep(base, TODAY).title.key).toBe("home.next.reading_title");
    // 23:30 UTC on 2 Oct is 00:30 on 3 Oct in Lagos: that counts as today.
    expect(nextBestStep({ ...base, lastVitalTakenAt: "2026-10-02T23:30:00Z" }, TODAY).title.key).toBe("home.next.ok_title");
    expect(nextBestStep({ ...base, lastVitalTakenAt: "2026-10-02T10:00:00Z" }, TODAY).title.key).toBe("home.next.reading_title");
  });

  it("never judges how the patient is doing", () => {
    const text = [en["home.next.ok_title"], en["home.next.ok_body"]].join(" ");
    expect(text).not.toMatch(/on track|good|well done|great/i);
  });
});

describe("heroMetric", () => {
  it("prefers BP, then glucose, then the dose count, else null", () => {
    expect(heroMetric({ ...base, latestBp: { systolic: 120, diastolic: 80 }, latestGlucoseMmolL: 5 }, "mmol_l")?.value).toBe("120/80");
    expect(heroMetric({ ...base, latestGlucoseMmolL: 5.5 }, "mmol_l")?.label).toBe("home.hero.glucose");
    expect(heroMetric({ ...base, dosesTotal: 3, dosesTaken: 1 }, "mmol_l")?.value).toBe("1/3");
    expect(heroMetric(base, "mmol_l")).toBeNull();
  });
});

describe("dueLine and agoLine", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  it("labels days by Lagos calendar day", () => {
    expect(dueLine("2026-10-03", now).key).toBe("home.due.today");
    expect(dueLine("2026-10-04", now).key).toBe("home.due.in_one");
    expect(dueLine("2026-10-08", now)).toEqual({ key: "home.due.in_many", params: { count: 5 } });
    expect(dueLine("2026-10-02", now).key).toBe("home.due.overdue_one");
    expect(dueLine("2026-09-30", now)).toEqual({ key: "home.due.overdue_many", params: { count: 3 } });
  });
  it("labels how long ago", () => {
    const t = now.getTime();
    expect(agoLine(new Date(t - 20_000).toISOString(), t).key).toBe("home.ago.now");
    expect(agoLine(new Date(t - 5 * 60_000).toISOString(), t)).toEqual({ key: "home.ago.minutes", params: { count: 5 } });
    expect(agoLine(new Date(t - 3 * 3_600_000).toISOString(), t).key).toBe("home.ago.hours");
    expect(agoLine(new Date(t - 50 * 3_600_000).toISOString(), t).key).toBe("home.ago.days");
  });
});

describe("every Home key exists in English and Pidgin", () => {
  const keys = Object.keys(en).filter((k) => k.startsWith("home."));
  it.each(keys)("%s", (k) => {
    expect(pcm[k as keyof typeof pcm]).toBeTruthy();
  });
  it("has the keys the model can emit", () => {
    const lines: Line[] = [dueLine("2026-10-03"), agoLine(new Date().toISOString()), nextBestStep(base, TODAY).title];
    for (const l of lines) expect(en[l.key]).toBeTruthy();
  });
});
