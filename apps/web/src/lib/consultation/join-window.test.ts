import { joinOpensAt, joinWindowState } from "./join-window";

const policy = { joinOpensMinutesBefore: 15, joinClosesMinutesAfter: 60 };
const start = "2026-11-10T10:00:00.000Z";
const at = (iso: string) => new Date(iso);

describe("joinWindowState", () => {
  it("is too early more than the opening minutes before the start", () => {
    expect(joinWindowState(start, at("2026-11-09T10:00:00Z"), policy)).toBe("too_early");
    expect(joinWindowState(start, at("2026-11-10T09:44:59Z"), policy)).toBe("too_early");
  });

  it("opens exactly at the opening minute and stays open through the start", () => {
    expect(joinWindowState(start, at("2026-11-10T09:45:00Z"), policy)).toBe("open");
    expect(joinWindowState(start, at("2026-11-10T10:00:00Z"), policy)).toBe("open");
    expect(joinWindowState(start, at("2026-11-10T11:00:00Z"), policy)).toBe("open");
  });

  it("closes after the closing minutes", () => {
    expect(joinWindowState(start, at("2026-11-10T11:00:01Z"), policy)).toBe("closed");
  });

  it("treats an unreadable time as closed, never open", () => {
    expect(joinWindowState("not a date", at("2026-11-10T10:00:00Z"), policy)).toBe("closed");
  });

  it("reads the live policy by default (15 before, 60 after)", () => {
    expect(joinWindowState(start, at("2026-11-10T09:46:00Z"))).toBe("open");
    expect(joinWindowState(start, at("2026-11-10T09:40:00Z"))).toBe("too_early");
  });

  it("reports when joining opens", () => {
    expect(joinOpensAt(start, policy).toISOString()).toBe("2026-11-10T09:45:00.000Z");
  });
});
