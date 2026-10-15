import { describe, expect, it } from "@jest/globals";
import { filtersToQuery, formatAge, formatIds, parseFilters, summarise, summaryTone } from "./model";

describe("parseFilters", () => {
  it("keeps known shapes", () => {
    expect(parseFilters({ status: "dead", subscriber: "paging.on_red", type: "triage.graded", before: "2026-10-13T10:00:00.123456+00:00", beforeId: "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10" })).toEqual({
      status: "dead", subscriber: "paging.on_red", eventType: "triage.graded", before: "2026-10-13T10:00:00.123456+00:00", beforeId: "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10",
    });
  });
  it("drops anything else instead of passing it on", () => {
    expect(parseFilters({ status: "x'; drop", subscriber: "A b", type: "../", before: "not a date", beforeId: "x" })).toEqual({
      status: null, subscriber: null, eventType: null, before: null, beforeId: null,
    });
    expect(parseFilters({})).toEqual({ status: null, subscriber: null, eventType: null, before: null, beforeId: null });
  });
  it("round-trips through the query string", () => {
    expect(filtersToQuery({})).toBe("");
    expect(filtersToQuery({ status: "dead", subscriber: "a.b", eventType: "c.d", before: "2026-10-13T10:00:00.000Z", beforeId: "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10" })).toBe(
      "?status=dead&subscriber=a.b&type=c.d&before=2026-10-13T10%3A00%3A00.000Z&beforeId=6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10",
    );
  });
});

describe("formatAge", () => {
  it("picks a sensible unit", () => {
    expect(formatAge(5, "en")).toBe("5 s");
    expect(formatAge(600, "en")).toBe("10 min");
    expect(formatAge(7200, "en")).toBe("2 h");
    expect(formatAge(3 * 86400, "en")).toBe("3 d");
    expect(formatAge(-4, "en")).toBe("0 s");
  });
});

describe("summary", () => {
  const rows = [
    { subscriber_key: "a", is_active: true, pending: 2, processing: 1, dead: 0, lag_incident_open: false },
    { subscriber_key: "b", is_active: false, pending: 9, processing: 0, dead: 1, lag_incident_open: true },
    { subscriber_key: "c", is_active: true, pending: 0, processing: 0, dead: 0, lag_incident_open: true },
  ];
  it("counts a dead delivery everywhere but a backlog only on active subscribers", () => {
    expect(summarise(rows)).toEqual({ waiting: 3, dead: 1, lagging: 1 });
  });
  it("is red for dead or lagging, amber for waiting, green when idle", () => {
    expect(summaryTone({ waiting: 0, dead: 1, lagging: 0 })).toBe("red");
    expect(summaryTone({ waiting: 0, dead: 0, lagging: 2 })).toBe("red");
    expect(summaryTone({ waiting: 4, dead: 0, lagging: 0 })).toBe("amber");
    expect(summaryTone({ waiting: 0, dead: 0, lagging: 0 })).toBe("green");
  });
});

describe("formatIds", () => {
  it("lists id keys and tolerates junk", () => {
    expect(formatIds({ observation_id: "o1", triage_event_id: "t1" })).toBe("observation_id: o1, triage_event_id: t1");
    expect(formatIds(null)).toBe("");
    expect(formatIds("x")).toBe("");
  });
});
