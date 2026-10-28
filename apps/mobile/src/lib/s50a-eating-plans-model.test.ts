import { chooseEatingResult, referralStatusText, CACHE_MAX_AGE_DAYS } from "./eating-plans-model";

const OK = {
  state: "ok",
  config_version: 1,
  swaps: [],
  plans: [{ code: "weight", title: "Eating for a healthy weight", intro: "i", care_team_prompt: "c", tips: [{ heading: "h", body: "b" }] }],
};
const NOW = new Date("2026-10-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

describe("a server answer always wins", () => {
  it("shows an ok answer and saves it", () => {
    const r = chooseEatingResult(OK, { json: JSON.stringify({ ...OK, plans: [] }), savedAt: daysAgo(1) }, NOW);
    expect(r.guidance.state).toBe("ok");
    expect(r.fromCache).toBe(false);
    expect(r.cache.action).toBe("write");
  });
  it("shows nothing AND erases the saved copy on a fresh unavailable answer", () => {
    const r = chooseEatingResult({ state: "unavailable" }, { json: JSON.stringify(OK), savedAt: daysAgo(1) }, NOW);
    expect(r.guidance.state).toBe("unavailable");
    expect(r.fromCache).toBe(false);
    expect(r.cache.action).toBe("clear");
  });
  it("treats an answer it does not understand as unavailable and erases the copy", () => {
    const r = chooseEatingResult({ state: "wat" }, { json: JSON.stringify(OK), savedAt: daysAgo(1) }, NOW);
    expect(r.guidance.state).toBe("unavailable");
    expect(r.cache.action).toBe("clear");
  });
});

describe("the pregnancy plan is never saved", () => {
  const PREG = { ...OK, plans: [{ ...OK.plans[0]!, code: "pregnancy", title: "Eating well in pregnancy" }] };
  it("is shown but clears any older copy instead of writing one", () => {
    const r = chooseEatingResult(PREG, { json: JSON.stringify(OK), savedAt: daysAgo(1) }, NOW);
    expect(r.guidance.state).toBe("ok");
    expect(r.cache.action).toBe("clear");
  });
  it("is not saved even alongside other plans", () => {
    const r = chooseEatingResult({ ...OK, plans: [...OK.plans, ...PREG.plans] }, null, NOW);
    expect(r.cache.action).toBe("clear");
  });
});

describe("offline", () => {
  it("shows a recent saved copy when the request failed", () => {
    const r = chooseEatingResult(null, { json: JSON.stringify(OK), savedAt: daysAgo(2) }, NOW);
    expect(r.guidance.state).toBe("ok");
    expect(r.fromCache).toBe(true);
    expect(r.cache.action).toBe("none");
  });
  it(`does not show a copy older than ${CACHE_MAX_AGE_DAYS} days`, () => {
    expect(chooseEatingResult(null, { json: JSON.stringify(OK), savedAt: daysAgo(CACHE_MAX_AGE_DAYS + 1) }, NOW).guidance.state).toBe("unavailable");
  });
  it("does not show a copy dated in the future, an unreadable copy, or no copy", () => {
    expect(chooseEatingResult(null, { json: JSON.stringify(OK), savedAt: daysAgo(-3) }, NOW).guidance.state).toBe("unavailable");
    expect(chooseEatingResult(null, { json: "{not json", savedAt: daysAgo(1) }, NOW).guidance.state).toBe("unavailable");
    expect(chooseEatingResult(null, null, NOW).guidance.state).toBe("unavailable");
  });
});

describe("referral status words", () => {
  it("has words for each known status and nothing for an unknown one", () => {
    for (const s of ["requested", "scheduled", "consultation_complete", "plan_issued", "declined", "not_applicable"]) expect(referralStatusText(s)).toBeTruthy();
    expect(referralStatusText("mystery")).toBeNull();
  });
});
