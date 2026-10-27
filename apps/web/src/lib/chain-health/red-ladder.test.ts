import { describe, expect, it } from "@jest/globals";
import { ladderConcerns, parseRedLadder } from "./red-ladder";

const good = {
  red_lane: { enabled: true, detection_budget_seconds: 360, inject_every_minutes: 3, last_judged_at: "2026-10-27T10:00:00Z", last_passed: true, last_stage: null, runs_24h: 480, failures_24h: 0 },
  dead_letters: { paging_enabled: true, subscribers: ["paging.on_red"], open: 0, unassigned: 0, paged_30d: 0 },
  rota: {
    required_clinicians: 5, window_days: 28, distinct_on_rota: 5, distinct_credentialed_on_rota: 5, eligible_on_call_staff: 5, hours_total: 672, hours_covered: 672,
    hours_uncovered: 0, hours_without_backup: 0, meets_minimum: true, clinicians: [{ name: "A", shifts: 3, hours: 24, credentialed: true }],
    sole_cmo_exception: { sunset: "2027-01-31", days_to_sunset: 96, in_force: true, expires_at: "2027-01-31T23:00:00Z" },
  },
  phone_fallbacks: { expired_pages_30d: 0, expired_pages_without_call_30d: 0, calls_30d: 0, last_call_at: null },
};

describe("parseRedLadder", () => {
  it("accepts the database shape", () => expect(parseRedLadder(good)?.rota.required_clinicians).toBe(5));
  it("rejects a reply that does not match instead of half rendering it", () => {
    expect(parseRedLadder(null)).toBeNull();
    expect(parseRedLadder({ ...good, rota: undefined })).toBeNull();
    expect(parseRedLadder({ ...good, red_lane: { ...good.red_lane, enabled: "yes" } })).toBeNull();
  });
});

describe("ladderConcerns", () => {
  it("has nothing to say when every check runs and cover is met", () => expect(ladderConcerns(good)).toEqual([]));

  it("never reads all clear when a check is switched off", () => {
    const keys = ladderConcerns({ ...good, red_lane: { ...good.red_lane, enabled: false }, dead_letters: { ...good.dead_letters, paging_enabled: false } }).map((c) => c.key);
    expect(keys).toEqual(["red_lane_off", "dead_letter_off"]);
  });

  it("flags a failed red lane run and an unassigned dead letter as severe", () => {
    const c = ladderConcerns({ ...good, red_lane: { ...good.red_lane, last_passed: false, last_stage: "page" }, dead_letters: { ...good.dead_letters, open: 1, unassigned: 1 } });
    expect(c.filter((x) => x.severe).map((x) => x.key)).toEqual(["red_lane_failed", "dead_letter_unassigned"]);
  });

  it("flags the rota below the minimum, severe when hours have nobody", () => {
    const c = ladderConcerns({ ...good, rota: { ...good.rota, meets_minimum: false, distinct_credentialed_on_rota: 2, hours_uncovered: 40 } });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: "rota", severe: true });
    expect(c[0].text).toContain("2 credentialed");
  });

  it("warns about the sole CMO sunset only while cover is short and the date is near", () => {
    const short = { ...good.rota, meets_minimum: false, distinct_credentialed_on_rota: 3, hours_uncovered: 0 };
    expect(ladderConcerns({ ...good, rota: { ...short, sole_cmo_exception: { ...good.rota.sole_cmo_exception, days_to_sunset: 96 } } }).map((c) => c.key)).toEqual(["rota"]);
    const near = ladderConcerns({ ...good, rota: { ...short, sole_cmo_exception: { ...good.rota.sole_cmo_exception, days_to_sunset: 5 } } });
    expect(near.map((c) => c.key)).toEqual(["rota", "sole_cmo"]);
    expect(near[1].severe).toBe(true);
    const ended = ladderConcerns({ ...good, rota: { ...short, sole_cmo_exception: { ...good.rota.sole_cmo_exception, days_to_sunset: -2, in_force: false } } });
    expect(ended[1].text).toContain("has ended");
  });

  it("flags expired pages with no logged phone call", () => {
    const c = ladderConcerns({ ...good, phone_fallbacks: { ...good.phone_fallbacks, expired_pages_30d: 2, expired_pages_without_call_30d: 1 } });
    expect(c[0]).toMatchObject({ key: "phone", severe: true });
  });
});
