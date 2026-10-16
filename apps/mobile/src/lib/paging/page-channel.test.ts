import { Platform } from "react-native";

const mockChannels: { id: string; opts: Record<string, unknown> }[] = [];
let mockThrow = false;
let mockExisting: Record<string, unknown> | null = null;
jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  AndroidAudioUsage: { ALARM: 4 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  setNotificationChannelAsync: async (id: string, opts: Record<string, unknown>) => {
    if (mockThrow) throw new Error("no");
    mockChannels.push({ id, opts });
    return { id };
  },
  getNotificationChannelAsync: async () => mockExisting,
}));
import { PAGE_CHANNEL_ID, ensurePageChannel, readPageChannelState } from "./page-channel";

beforeEach(() => {
  mockChannels.length = 0;
  mockThrow = false;
  mockExisting = null;
});

describe("the on-call alarm channel", () => {
  it("is maximum importance, on the alarm audio stream, asks to override Do Not Disturb and shows on the lock screen", async () => {
    Platform.OS = "android";
    await expect(ensurePageChannel()).resolves.toBe(true);
    expect(mockChannels).toHaveLength(1);
    expect(mockChannels[0]?.id).toBe(PAGE_CHANNEL_ID);
    expect(mockChannels[0]?.opts).toMatchObject({ importance: 5, bypassDnd: true, lockscreenVisibility: 1, enableVibrate: true, audioAttributes: { usage: 4 } });
  });
  it("does nothing on iPhone and says it is ready", async () => {
    Platform.OS = "ios";
    await expect(ensurePageChannel()).resolves.toBe(true);
    expect(mockChannels).toHaveLength(0);
  });
  it("reports not ready (so the server keeps the urgent channel) when the phone refuses", async () => {
    Platform.OS = "android";
    mockThrow = true;
    await expect(ensurePageChannel()).resolves.toBe(false);
  });
  it("reads back what the phone really has", async () => {
    Platform.OS = "android";
    await expect(readPageChannelState()).resolves.toEqual({ exists: false, loud: false, overridesDoNotDisturb: false });
    mockExisting = { importance: 5, bypassDnd: false };
    await expect(readPageChannelState()).resolves.toEqual({ exists: true, loud: true, overridesDoNotDisturb: false });
    mockExisting = { importance: 2, bypassDnd: true };
    await expect(readPageChannelState()).resolves.toEqual({ exists: true, loud: false, overridesDoNotDisturb: true });
    Platform.OS = "ios";
    await expect(readPageChannelState()).resolves.toBeNull();
  });
});
