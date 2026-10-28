jest.mock("./app-lock", () => ({ readAppLockEnabled: jest.fn() }));
jest.mock("./notification-settings", () => ({ loadNotificationSettings: jest.fn() }));
jest.mock("./supabase", () => ({ supabase: { auth: { getSession: jest.fn() } } }));

import { readAppLockEnabled } from "./app-lock";
import { loadNotificationSettings } from "./notification-settings";
import { supabase } from "./supabase";
import { __resetCoverCache, coverEnabled, coverVisible, DISCREET_TTL_MS, loadCoverEnabled } from "./privacy-cover";

const lock = readAppLockEnabled as jest.Mock;
const settings = loadNotificationSettings as jest.Mock;
const session = supabase.auth.getSession as jest.Mock;

beforeEach(() => {
  __resetCoverCache();
  lock.mockReset();
  settings.mockReset();
  session.mockReset();
});

describe("coverEnabled", () => {
  it("is on for App lock, or discreet mode, or both; off for neither", () => {
    expect(coverEnabled({ appLockOn: true, discreetOn: false })).toBe(true);
    expect(coverEnabled({ appLockOn: false, discreetOn: true })).toBe(true);
    expect(coverEnabled({ appLockOn: true, discreetOn: true })).toBe(true);
    expect(coverEnabled({ appLockOn: false, discreetOn: false })).toBe(false);
  });
});

describe("coverVisible", () => {
  it("covers iOS inactive (app switcher) and background, and never the active app", () => {
    expect(coverVisible("inactive", true)).toBe(true);
    expect(coverVisible("background", true)).toBe(true);
    expect(coverVisible("active", true)).toBe(false);
  });
  it("never covers for someone who did not ask for it", () => {
    expect(coverVisible("inactive", false)).toBe(false);
    expect(coverVisible("background", false)).toBe(false);
  });
  it("covers an unknown state rather than showing the record (anything that is not 'active')", () => {
    expect(coverVisible("unknown", true)).toBe(true);
  });
});

describe("loadCoverEnabled", () => {
  it("App lock on is enough, with no network read at all", async () => {
    lock.mockResolvedValue(true);
    expect(await loadCoverEnabled()).toBe(true);
    expect(session).not.toHaveBeenCalled();
  });

  it("with App lock off it follows the discreet mode setting", async () => {
    lock.mockResolvedValue(false);
    session.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    settings.mockResolvedValue({ ok: true, data: { discreet: true } });
    expect(await loadCoverEnabled()).toBe(true);
    __resetCoverCache();
    settings.mockResolvedValue({ ok: true, data: { discreet: false } });
    expect(await loadCoverEnabled()).toBe(false);
  });

  it("a signed-out phone, a failed settings read or a thrown read all mean 'off', never a crash", async () => {
    lock.mockResolvedValue(false);
    session.mockResolvedValue({ data: { session: null } });
    expect(await loadCoverEnabled()).toBe(false);
    session.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    settings.mockResolvedValue({ ok: false, error: "network" });
    expect(await loadCoverEnabled()).toBe(false);
    settings.mockRejectedValue(new Error("boom"));
    expect(await loadCoverEnabled()).toBe(false);
  });

  it("remembers the discreet answer for ten minutes (one network read, not one per return to the app), then asks again", async () => {
    lock.mockResolvedValue(false);
    session.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    settings.mockResolvedValue({ ok: true, data: { discreet: true } });
    let t = 1_000_000;
    expect(await loadCoverEnabled(() => t)).toBe(true);
    t += DISCREET_TTL_MS - 1;
    expect(await loadCoverEnabled(() => t)).toBe(true);
    expect(settings).toHaveBeenCalledTimes(1);
    t += 2;
    settings.mockResolvedValue({ ok: true, data: { discreet: false } });
    expect(await loadCoverEnabled(() => t)).toBe(false);
    expect(settings).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failed read, and does not share one account's answer with another", async () => {
    lock.mockResolvedValue(false);
    session.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    settings.mockResolvedValueOnce({ ok: false, error: "network" });
    expect(await loadCoverEnabled(() => 5)).toBe(false);
    settings.mockResolvedValueOnce({ ok: true, data: { discreet: true } });
    expect(await loadCoverEnabled(() => 6)).toBe(true);
    session.mockResolvedValue({ data: { session: { user: { id: "u2" } } } });
    settings.mockResolvedValueOnce({ ok: true, data: { discreet: false } });
    expect(await loadCoverEnabled(() => 7)).toBe(false);
  });

  it("App lock is always read fresh, so turning it on applies at once even with a remembered discreet answer", async () => {
    lock.mockResolvedValue(false);
    session.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    settings.mockResolvedValue({ ok: true, data: { discreet: false } });
    expect(await loadCoverEnabled(() => 1)).toBe(false);
    lock.mockResolvedValue(true);
    expect(await loadCoverEnabled(() => 2)).toBe(true);
  });

  it("an unreadable App lock preference does not stop the discreet check", async () => {
    lock.mockRejectedValue(new Error("keystore"));
    session.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    settings.mockResolvedValue({ ok: true, data: { discreet: true } });
    expect(await loadCoverEnabled()).toBe(true);
  });
});
