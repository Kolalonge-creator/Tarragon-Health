// S85 journey harness: a deterministic clock.
//
// Two things need a fixed time. The browser (Playwright's own page.clock does that) and the harness's own waiting: the bus
// drain budget and any polling. The Clock below is what harness code uses instead of Date.now() and setTimeout, so a test can
// say "it is 02:00 in Lagos" and never wait for real time. Server side clocks (database now()) are NOT faked: where a rule
// depends on elapsed minutes (the paging ladder), the journey moves the row's own timestamp backwards through the same guarded
// flag the DB proofs use, and says so in the step.

export interface Clock {
  now(): number;
  /** Advance a fake clock by ms (no real waiting); a real clock really sleeps. */
  sleep(ms: number): Promise<void>;
}

export class FixedClock implements Clock {
  private t: number;
  constructor(startIso: string) {
    this.t = Date.parse(startIso);
    if (Number.isNaN(this.t)) throw new Error(`FixedClock: bad start time ${startIso}`);
  }
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    this.t += ms;
    return Promise.resolve();
  }
  iso(): string {
    return new Date(this.t).toISOString();
  }
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** 02:00 on a fixed night in Lagos (UTC+1, no daylight saving) expressed as a UTC instant: 01:00Z. */
export const NIGHT_2AM_LAGOS_ISO = "2026-10-08T01:00:00.000Z";
