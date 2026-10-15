import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@tarragon/i18n";
import { SLEEP_SCREEN_ITEM_IDS, SLEEP_WEEKLY_MESSAGE_KEYS } from "@tarragon/shared";
import { logSleepEntrySchema } from "@/lib/validation/sleep";

const text = (k: string) => (en as Record<string, string>)[k];
const WEB = join(process.cwd(), "src");

describe("S57 copy", () => {
  it("every weekly sleep message exists, gives no restriction advice and shows no score", () => {
    for (const k of SLEEP_WEEKLY_MESSAGE_KEYS) {
      expect(text(k)).toBeDefined();
      expect(text(k)).not.toMatch(/restrict|less time in bed|stay in bed less|go to bed later|cut down your time|sleep score of|out of 100/i);
    }
    expect(text("sleep.weekly.no_score_note")).toMatch(/do not give you a sleep score/i);
  });
  it("every questionnaire item has wording, and an unsigned save says nothing about a result", () => {
    for (const id of SLEEP_SCREEN_ITEM_IDS) expect(text(`sleep.screen.item.${id}`)).toBeTruthy();
    expect(text("sleep.screen.saved_only")).not.toMatch(/sleep apn|suggest|flag/i);
    expect(text("sleep.screen.talk_to_care_team")).toMatch(/not a diagnosis/i);
  });
  it("new copy uses no em dash and none of the banned phrases", () => {
    const keys = Object.keys(en).filter((k) => /^(library|breathing|journal|sleep\.(diary|weekly|winddown|screen))\./.test(k));
    expect(keys.length).toBeGreaterThan(80);
    for (const k of keys) {
      expect(text(k)).not.toMatch(/—|–/);
      expect(text(k)).not.toMatch(/your doctor|\bcure\b|instant doctor|free healthcare/i);
    }
  });
  it("the breathing and exercise notes carry the stop-and-seek-care and care-team wording and claim no effect", () => {
    expect(text("breathing.safety")).toMatch(/stop and seek care/i);
    expect(text("breathing.safety")).toMatch(/does not treat/i);
    expect(text("library.exercise.note")).toMatch(/not therapy/i);
    expect(text("library.exercise.note")).toMatch(/care team/i);
  });
  it("no reminder is promised that nothing delivers", () => {
    expect(Object.keys(en).filter((k) => k.startsWith("sleep.winddown.reminder"))).toEqual([]);
  });
});

describe("sleep diary validation", () => {
  const base = { duration_hours: "7" };
  it("treats a blank optional field as not given, not as zero", () => {
    const r = logSleepEntrySchema.parse({ ...base, sleep_latency_minutes: "", night_awakenings: "" });
    expect(r.sleep_latency_minutes).toBeUndefined();
    expect(r.night_awakenings).toBeUndefined();
  });
  it("accepts a real value and refuses an absurd one", () => {
    expect(logSleepEntrySchema.parse({ ...base, sleep_latency_minutes: "25", night_awakenings: "3" }).night_awakenings).toBe(3);
    expect(logSleepEntrySchema.safeParse({ ...base, sleep_latency_minutes: "9999" }).success).toBe(false);
  });
});

describe("the journal never sends readable text to the server", () => {
  const src = readFileSync(join(WEB, "app/(dashboard)/patient/(sections)/wellbeing/journal/journal-client.tsx"), "utf8");
  it("the only upsert call carries the sealed fields", () => {
    const call = /rpc\("upsert_journal_entry",\s*\{([^}]*)\}/.exec(src);
    expect(call).not.toBeNull();
    const keys = (call?.[1] ?? "").split(",").map((p) => p.split(":")[0]?.trim());
    expect(keys.sort()).toEqual(["p_alg", "p_ciphertext", "p_client_entry_id", "p_client_updated_at", "p_iv"]);
  });
  it("it never reads synced entries back or writes the table directly", () => {
    expect(src).not.toMatch(/from\("journal_synced_entries"\)/);
  });
});
