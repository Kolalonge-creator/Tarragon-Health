import { describe, expect, it, jest } from "@jest/globals";

jest.mock("./supabase", () => ({ supabase: {} }));

import { groupBySeries, mayDownload, scriptSteps, downloadCaps, type LibraryItem } from "./calm-library";

const item = (series: string, code: string, script: LibraryItem["script"] = null): LibraryItem => ({
  id: code, code, kind: "meditation", exercise_type: null, title: code, summary: null, series, series_position: 1, voice: null, duration_seconds: 60, script, reviewed_by_name: null, reviewed_at: null,
});

describe("calm library (mobile)", () => {
  it("orders series as designed and drops empty ones", () => {
    const g = groupBySeries([item("sleep", "a"), item("stress", "b"), item("intro", "c")]);
    expect(g.map((x) => x.series)).toEqual(["intro", "stress", "sleep"]);
  });
  it("reads only non-empty script steps", () => {
    expect(scriptSteps(item("general", "x", { steps: [{ text: "one" }, { text: "" }, {}] }))).toEqual(["one"]);
  });
  it("never assumes Wi-Fi when no network module exists", async () => {
    const r = await mayDownload({ bytes: 1000, packBytesNow: 0, expiresOn: "2030-01-01", today: "2026-10-07" }, null);
    expect(r).toEqual({ ok: false, reason: "not_on_wifi" });
  });
  it("allows a small item on Wi-Fi and refuses a failed probe", async () => {
    const args = { bytes: 1000, packBytesNow: 0, expiresOn: "2030-01-01", today: "2026-10-07" };
    expect(await mayDownload(args, { isOnWifi: async () => true })).toEqual({ ok: true });
    expect(await mayDownload(args, { isOnWifi: async () => { throw new Error("x"); } })).toEqual({ ok: false, reason: "not_on_wifi" });
  });
  it("refuses over the configured track cap", async () => {
    const cap = downloadCaps().max_track_bytes;
    expect(await mayDownload({ bytes: cap + 1, packBytesNow: 0, expiresOn: "2030-01-01", today: "2026-10-07" }, { isOnWifi: async () => true })).toEqual({ ok: false, reason: "track_too_large" });
  });
});
