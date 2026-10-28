import { deviceSyncLine } from "./device-sync-line";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("deviceSyncLine", () => {
  it("says when it last synced in words, not a bare date", () => {
    expect(deviceSyncLine(ago(3 * HOUR), NOW, "en")).toEqual({ text: "Synced 3 hours ago", showNote: false });
    expect(deviceSyncLine(ago(1 * HOUR), NOW, "en").text).toBe("Synced 1 hour ago");
    expect(deviceSyncLine(ago(2 * DAY), NOW, "en").text).toBe("Synced 2 days ago");
  });
  it("a device never synced says so and adds no note", () => {
    expect(deviceSyncLine(null, NOW, "en")).toEqual({ text: "Not synced yet", showNote: false });
  });
  it("a week or more of quiet adds the note, and still says how long", () => {
    const r = deviceSyncLine(ago(9 * DAY), NOW, "en");
    expect(r.text).toBe("Synced 9 days ago");
    expect(r.showNote).toBe(true);
  });
  it("an unreadable time is worded cautiously and adds the note", () => {
    expect(deviceSyncLine("garbage", NOW, "en")).toEqual({ text: "We cannot tell when this last synced", showNote: true });
  });
});
