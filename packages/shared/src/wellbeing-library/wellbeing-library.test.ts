import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "../proposed-config";
import { breathCycle, breathPositionAt, breathingProblem } from "./paced-breathing";
import { hoursInBed, weeklySleepFeedback } from "./sleep-feedback";
import { downloadDecision, planPackRefresh } from "./download-policy";
import { fromBase64, newJournalKey, openJournalEntry, sealJournalEntry, toBase64, type RandomBytes } from "./journal-crypto";
import { SLEEP_SCREEN_ITEM_IDS, sleepScreenMessageKey } from "./sleep-screen";

const bounds = (getProposedConfig("media_library.config").value as { breathing: { min_seconds: number; max_seconds: number; max_phase_seconds: number } }).breathing;
const caps = (getProposedConfig("media_library.config").value as { download: { wifi_only: boolean; max_track_bytes: number; max_pack_bytes: number } }).download;
const epsilon = (getProposedConfig("media_library.config").value as { sleep_feedback: { change_epsilon_pct: number } }).sleep_feedback.change_epsilon_pct;

describe("paced breathing", () => {
  const pattern = { inhale_s: 4, hold_s: 0, exhale_s: 6 };
  it("accepts a pattern within the configured bounds and refuses the rest", () => {
    expect(breathingProblem(pattern, bounds.min_seconds, bounds)).toBeNull();
    expect(breathingProblem(pattern, bounds.min_seconds - 1, bounds)).toBe("length_out_of_bounds");
    expect(breathingProblem(pattern, bounds.max_seconds + 1, bounds)).toBe("length_out_of_bounds");
    expect(breathingProblem({ inhale_s: bounds.max_phase_seconds + 1, exhale_s: 4 }, bounds.min_seconds, bounds)).toBe("phase_too_long");
    expect(breathingProblem({ inhale_s: 0, exhale_s: 4 }, bounds.min_seconds, bounds)).toBe("phase_missing");
  });
  it("leaves a zero hold out of the cycle", () => {
    expect(breathCycle(pattern).map((s) => s.phase)).toEqual(["inhale", "exhale"]);
    expect(breathCycle({ ...pattern, hold_s: 2 }).map((s) => s.phase)).toEqual(["inhale", "hold", "exhale"]);
  });
  it("walks phases, counts down, and ends", () => {
    expect(breathPositionAt(pattern, 180, 0)).toMatchObject({ phase: "inhale", secondsLeft: 4, done: false });
    expect(breathPositionAt(pattern, 180, 3.5)).toMatchObject({ phase: "inhale", secondsLeft: 1 });
    expect(breathPositionAt(pattern, 180, 4)).toMatchObject({ phase: "exhale", secondsLeft: 6 });
    expect(breathPositionAt(pattern, 180, 10)).toMatchObject({ phase: "inhale", cycle: 1 });
    expect(breathPositionAt(pattern, 180, 180).done).toBe(true);
    expect(breathPositionAt(pattern, 180, -5)).toMatchObject({ phase: "inhale" });
  });
});

describe("weekly sleep feedback", () => {
  const night = (d: string, hrs: number, bed = "23:00", wake = "06:00") => ({ logged_on: d, duration_hours: hrs, bedtime: bed, waketime: wake, sleep_latency_minutes: 20, night_awakenings: 2 });
  it("computes time in bed across midnight and the share asleep", () => {
    expect(hoursInBed("23:00", "06:00")).toBe(7);
    expect(hoursInBed(null, "06:00")).toBeNull();
    const f = weeklySleepFeedback([night("2026-10-01", 6.3), night("2026-10-02", 7)], [], epsilon);
    expect(f.nights).toBe(2);
    expect(f.sleepShareOfTimeInBedPct).toBe(95);
    expect(f.averageInBedHours).toBe(7);
    expect(f.earliestBedtime).toBe("23:00");
    expect(f.shareTrend).toBe("not_enough_data");
  });
  it("reports the change from last week as a difference, with a threshold from config", () => {
    const now = [night("2026-10-08", 7)];
    const before = [night("2026-10-01", 5.6)];
    expect(weeklySleepFeedback(now, before, epsilon).shareTrend).toBe("higher");
    expect(weeklySleepFeedback(before, now, epsilon).shareTrend).toBe("lower");
    expect(weeklySleepFeedback(now, now, epsilon).shareTrend).toBe("about_the_same");
  });
  it("has no combined score field", () => {
    const f = weeklySleepFeedback([night("2026-10-01", 7)], [], epsilon);
    expect(Object.keys(f).filter((k) => /score|rating|grade/i.test(k))).toEqual([]);
  });
});

describe("download policy", () => {
  const base = { onWifi: true, bytes: 1_000_000, packBytesNow: 0, expiresOn: "2026-12-01", today: "2026-10-07", caps };
  it("allows a small item on Wi-Fi", () => expect(downloadDecision(base)).toEqual({ ok: true }));
  it("refuses off Wi-Fi, over the track cap, over the pack cap and when expired", () => {
    expect(downloadDecision({ ...base, onWifi: false })).toEqual({ ok: false, reason: "not_on_wifi" });
    expect(downloadDecision({ ...base, bytes: caps.max_track_bytes + 1 })).toEqual({ ok: false, reason: "track_too_large" });
    expect(downloadDecision({ ...base, packBytesNow: caps.max_pack_bytes })).toEqual({ ok: false, reason: "pack_full" });
    expect(downloadDecision({ ...base, expiresOn: "2026-10-07" })).toEqual({ ok: false, reason: "expired" });
  });
  const item = (id: string, exp: string, upd = "2026-10-01T00:00:00Z") => ({ id, bytes: 1, expires_on: exp, updated_at: upd });
  it("a failed refresh deletes only expired items and never empties the pack", () => {
    const local = [item("a", "2026-12-01"), item("b", "2026-10-06")];
    expect(planPackRefresh({ manifest: null, local, today: "2026-10-07" })).toEqual({ toFetch: [], toDelete: ["b"] });
  });
  it("a refresh fetches new and changed items and drops items the server no longer lists", () => {
    const local = [item("a", "2026-12-01"), item("gone", "2026-12-01")];
    const manifest = [item("a", "2026-12-01", "2026-10-05T00:00:00Z"), item("new", "2026-12-01")];
    const plan = planPackRefresh({ manifest, local, today: "2026-10-07" });
    expect(plan.toFetch.map((i) => i.id).sort()).toEqual(["a", "new"]);
    expect(plan.toDelete).toEqual(["gone"]);
  });
});

describe("journal encryption", () => {
  let counter = 1;
  const random: RandomBytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + counter++) % 256);
  const key = newJournalKey(random);
  it("round-trips and the server copy is not the plaintext", () => {
    const sealed = sealJournalEntry(key, "entry-1", "Today was heavy but I got through it.", random);
    expect(sealed.ciphertext).not.toContain("heavy");
    expect(atob(sealed.ciphertext)).not.toContain("heavy");
    expect(openJournalEntry(key, "entry-1", sealed)).toBe("Today was heavy but I got through it.");
  });
  it("a different nonce each time", () => {
    const a = sealJournalEntry(key, "e", "same", random);
    const b = sealJournalEntry(key, "e", "same", random);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it("opens to null with the wrong key, a moved entry id, or a changed byte", () => {
    const sealed = sealJournalEntry(key, "entry-1", "private", random);
    expect(openJournalEntry(newJournalKey(random), "entry-1", sealed)).toBeNull();
    expect(openJournalEntry(key, "entry-2", sealed)).toBeNull();
    const bytes = fromBase64(sealed.ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(openJournalEntry(key, "entry-1", { ...sealed, ciphertext: toBase64(bytes) })).toBeNull();
    expect(openJournalEntry(key, "entry-1", { ...sealed, alg: "none" as never })).toBeNull();
  });
  it("rejects a key of the wrong length", () => {
    expect(() => sealJournalEntry(new Uint8Array(5), "e", "x", random)).toThrow();
  });
});

describe("sleep screen messages", () => {
  it("an unsigned instrument shows only that the answers were saved, whatever the cut-off flag", () => {
    expect(sleepScreenMessageKey({ saved: true, show_result: false, cut_off_met: null, unsure_count: 0 })).toBe("sleep.screen.saved_only");
    expect(sleepScreenMessageKey({ saved: true, show_result: false, cut_off_met: true, unsure_count: 0 })).toBe("sleep.screen.saved_only");
  });
  it("a signed instrument shows the result", () => {
    expect(sleepScreenMessageKey({ saved: true, show_result: true, cut_off_met: true, unsure_count: 0 })).toBe("sleep.screen.talk_to_care_team");
    expect(sleepScreenMessageKey({ saved: true, show_result: true, cut_off_met: false, unsure_count: 0 })).toBe("sleep.screen.nothing_flagged");
  });
  it("the item ids are exactly the configured ones", () => {
    const cfg = getProposedConfig("sleep.apnoea_screen").value as { items: { id: string }[] };
    expect(cfg.items.map((i) => i.id)).toEqual([...SLEEP_SCREEN_ITEM_IDS]);
  });
});
