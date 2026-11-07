import { granularityFor, lagosToday, parseIsoDate, periodLabel, periodSearchParams, resolvePeriod } from "./periods";

const TODAY = "2026-11-07"; // a Saturday

describe("resolvePeriod", () => {
  it("defaults to this month against the previous period of equal length", () => {
    const p = resolvePeriod({}, TODAY);
    expect(p).toMatchObject({ key: "this_month", from: "2026-11-01", to: "2026-11-07", compareFrom: "2026-10-25", compareTo: "2026-10-31", granularity: "day" });
  });

  it("starts the week on Monday", () => {
    expect(resolvePeriod({ period: "this_week" }, TODAY)).toMatchObject({ from: "2026-11-02", to: "2026-11-07" });
    expect(resolvePeriod({ period: "this_week" }, "2026-11-02")).toMatchObject({ from: "2026-11-02", to: "2026-11-02" });
    expect(resolvePeriod({ period: "this_week" }, "2026-11-08")).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
  });

  it("covers the whole of last month, including across a year end", () => {
    expect(resolvePeriod({ period: "last_month" }, TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod({ period: "last_month" }, "2027-01-15")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("resolves quarter and year to date", () => {
    expect(resolvePeriod({ period: "this_quarter" }, TODAY)).toMatchObject({ from: "2026-10-01", to: TODAY, granularity: "day" });
    expect(resolvePeriod({ period: "year_to_date" }, TODAY)).toMatchObject({ from: "2026-01-01", to: TODAY, granularity: "month" });
  });

  it("compares with the same dates last year, clamping 29 February", () => {
    const p = resolvePeriod({ period: "custom", from: "2028-02-01", to: "2028-02-29", compare: "previous_year" }, "2028-03-10");
    expect(p).toMatchObject({ compareFrom: "2027-02-01", compareTo: "2027-02-28" });
  });

  it("omits the comparison when asked", () => {
    expect(resolvePeriod({ compare: "none" }, TODAY)).toMatchObject({ compareFrom: null, compareTo: null });
  });

  it("accepts a valid custom range", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-06-01", to: "2026-08-31" }, TODAY)).toMatchObject({
      key: "custom", from: "2026-06-01", to: "2026-08-31", compareFrom: "2026-03-01", compareTo: "2026-05-31", granularity: "week",
    });
  });

  it.each([
    ["missing dates", {}],
    ["reversed", { from: "2026-08-31", to: "2026-06-01" }],
    ["not a real date", { from: "2026-02-30", to: "2026-03-01" }],
    ["wrong format", { from: "01/06/2026", to: "2026-08-31" }],
    ["over ten years", { from: "2010-01-01", to: "2026-08-31" }],
  ])("falls back to this month for a bad custom range (%s), never a mislabelled range", (_name, dates) => {
    const p = resolvePeriod({ period: "custom", ...dates }, TODAY);
    expect(p).toMatchObject({ key: "this_month", from: "2026-11-01", to: TODAY });
  });

  it("falls back for an unknown period or compare key", () => {
    expect(resolvePeriod({ period: "forever", compare: "sideways" }, TODAY)).toMatchObject({ key: "this_month", compare: "previous_period" });
  });

  it("refuses a malformed today rather than guessing", () => {
    expect(() => resolvePeriod({}, "7 Nov")).toThrow();
  });
});

describe("helpers", () => {
  it("parses only real calendar dates", () => {
    expect(parseIsoDate("2026-11-07")).not.toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-02-29")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it("chooses buckets by span", () => {
    expect(granularityFor("2026-11-01", "2026-12-31")).toBe("day");
    expect(granularityFor("2026-01-01", "2026-05-31")).toBe("week");
    expect(granularityFor("2026-01-01", "2026-12-31")).toBe("month");
  });

  it("uses Lagos time for today, an hour ahead of UTC", () => {
    expect(lagosToday(new Date("2026-11-07T23:30:00Z"))).toBe("2026-11-08");
    expect(lagosToday(new Date("2026-11-07T22:59:00Z"))).toBe("2026-11-07");
  });

  it("labels periods readably", () => {
    expect(periodLabel("2026-11-01", "2026-11-07")).toBe("1 Nov to 7 Nov 2026");
    expect(periodLabel("2025-12-01", "2026-01-31")).toBe("1 Dec 2025 to 31 Jan 2026");
    expect(periodLabel("2026-11-07", "2026-11-07")).toBe("7 Nov 2026");
  });

  it("keeps custom dates only for a custom period", () => {
    expect(periodSearchParams({ period: "this_month", compare: "none", from: "2026-01-01", to: "2026-01-02" }).toString()).toBe("period=this_month&compare=none");
    expect(periodSearchParams({ period: "custom", compare: "none", from: "2026-01-01", to: "2026-01-02" }).toString()).toBe(
      "period=custom&compare=none&from=2026-01-01&to=2026-01-02"
    );
  });
});
