import { Platform } from "react-native";
import { readFileSync } from "node:fs";

const mockChannels: { id: string; opts: Record<string, unknown> }[] = [];
let mockThrow = false;
jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3, MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  setNotificationChannelAsync: async (id: string, opts: Record<string, unknown>) => {
    if (mockThrow) throw new Error("no");
    mockChannels.push({ id, opts });
  },
}));
import { DEFAULT_CHANNEL_ID, URGENT_CHANNEL_ID, ensureNotificationChannels } from "./notification-channels";

beforeEach(() => {
  mockChannels.length = 0;
  mockThrow = false;
});

describe("android notification channels", () => {
  it("creates a default and a maximum-importance urgent channel with a vibration pattern", async () => {
    Platform.OS = "android";
    await expect(ensureNotificationChannels()).resolves.toBe(true);
    expect(mockChannels.map((c) => c.id)).toEqual([DEFAULT_CHANNEL_ID, URGENT_CHANNEL_ID]);
    const urgent = mockChannels.find((c) => c.id === URGENT_CHANNEL_ID)!;
    expect(urgent.opts).toMatchObject({ importance: 5, enableVibrate: true });
    expect(URGENT_CHANNEL_ID).toBe("urgent");
  });
  it("does nothing on iPhone", async () => {
    Platform.OS = "ios";
    await expect(ensureNotificationChannels()).resolves.toBe(true);
    expect(mockChannels).toHaveLength(0);
  });
  it("never throws, and says the channel is not ready so the server does not name it", async () => {
    Platform.OS = "android";
    mockThrow = true;
    await expect(ensureNotificationChannels()).resolves.toBe(false);
  });
  it("is called before the permission prompt", () => {
    const src = readFileSync("src/lib/push-registration.ts", "utf8");
    expect(src.indexOf("await ensureNotificationChannels()")).toBeGreaterThan(-1);
    expect(src.indexOf("await ensureNotificationChannels()")).toBeLessThan(src.indexOf("requestPermissionsAsync"));
  });
  it("uses no full-screen intent", () => {
    expect(readFileSync("src/lib/notification-channels.ts", "utf8")).not.toMatch(/fullScreen|USE_FULL_SCREEN/i);
  });
});

describe("app.config.js (iPhone entitlements are opt-in per build)", () => {
  const load = () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../app.config.js") as (a: { config: Record<string, unknown> }) => Record<string, unknown>;
  };
  const config = { name: "x", ios: { bundleIdentifier: "b" } };
  afterEach(() => {
    delete process.env.IOS_TIME_SENSITIVE;
    delete process.env.IOS_CRITICAL_ALERTS_ENTITLEMENT;
  });
  it("adds nothing by default, so a build never breaks before Apple approves", () => {
    expect(load()({ config })).toBe(config);
  });
  it("adds only the time-sensitive capability when asked", () => {
    process.env.IOS_TIME_SENSITIVE = "1";
    expect((load()({ config }).ios as { entitlements: Record<string, boolean> }).entitlements).toEqual({ "com.apple.developer.usernotifications.time-sensitive": true });
  });
  it("adds critical alerts only when the flag is set", () => {
    process.env.IOS_CRITICAL_ALERTS_ENTITLEMENT = "1";
    expect((load()({ config }).ios as { entitlements: Record<string, boolean> }).entitlements).toEqual({ "com.apple.developer.usernotifications.critical-alerts": true });
  });
});
