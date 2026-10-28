const mockRpc = jest.fn();
const mockSignOut = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a), auth: { signOut: (...a: unknown[]) => mockSignOut(...a) } },
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({ status: "granted" }),
  requestPermissionsAsync: async () => ({ status: "granted" }),
  getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[jest]" }),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: async () => null,
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: "p" } } } } }));
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@/lib/notification-settings", () => ({ reportNotificationOpened: jest.fn() }));
jest.mock("@/lib/notification-channels", () => ({ ensureNotificationChannels: async () => true }));
jest.mock("@/lib/paging/page-channel", () => ({ ensurePageChannel: async () => true }));
jest.mock("@/lib/paging/critical-alerts", () => ({ criticalAlertsRequested: () => false }));

import { registerPushToken, unregisterPushToken } from "./push-registration";
import { signOutOfThisPhone } from "./sign-out";

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockSignOut.mockReset().mockResolvedValue({ error: null });
});

describe("native push registration follows the signed-in account", () => {
  it("registers through register_native_push_token, with no page channel for a patient", async () => {
    await registerPushToken("u1", "o1");
    expect(mockRpc).toHaveBeenCalledWith("register_native_push_token", {
      p_token: "ExponentPushToken[jest]",
      p_platform: "ios",
      p_urgent_channel_ready: true,
      p_page_channel_ready: null,
    });
  });

  it("sends the page channel only from a clinician's phone", async () => {
    await registerPushToken("u1", "o1", { clinician: true });
    expect(mockRpc).toHaveBeenCalledWith("register_native_push_token", expect.objectContaining({ p_page_channel_ready: true }));
  });

  it("never sends the user or organisation id: the database reads them from the session", async () => {
    await registerPushToken("u1", "o1");
    const args = JSON.stringify(mockRpc.mock.calls[0][1]);
    expect(args).not.toContain("u1");
    expect(args).not.toContain("o1");
  });
});

describe("sign-out switches this phone's token off first", () => {
  it("unregisters the remembered token, then signs out, in that order", async () => {
    await registerPushToken("u1", "o1");
    mockRpc.mockClear();
    const order: string[] = [];
    mockRpc.mockImplementation(async (fn: string) => { order.push(fn); return { data: null, error: null }; });
    mockSignOut.mockImplementation(async () => { order.push("signOut"); return { error: null }; });
    await signOutOfThisPhone();
    expect(order).toEqual(["unregister_native_push_token", "signOut"]);
    expect(mockRpc).toHaveBeenCalledWith("unregister_native_push_token", { p_token: "ExponentPushToken[jest]" });
  });

  it("still signs out when the unregister call fails or hangs", async () => {
    await registerPushToken("u1", "o1");
    mockRpc.mockRejectedValue(new Error("offline"));
    await expect(signOutOfThisPhone({ scope: "local" })).resolves.toBeUndefined();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does nothing server-side when no token was registered in this run", async () => {
    await unregisterPushToken(); // clears any token from a previous test
    mockRpc.mockClear();
    await unregisterPushToken();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
