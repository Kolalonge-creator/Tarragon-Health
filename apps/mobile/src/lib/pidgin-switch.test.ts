/**
 * Mobile reader for the Pidgin kill switch: it reflects an admin's change, and a
 * failed read falls back to the last value this phone saw (so a patient on a poor
 * connection keeps Pidgin while it is on), assuming on only when nothing is known.
 */
const mockStore: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  },
}));
const mockRpc = jest.fn();
jest.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { clearPidginSwitchCache, getPidginEnabled } from "./pidgin-switch";

describe("mobile Pidgin switch", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockStore)) delete mockStore[k];
    mockRpc.mockReset();
    clearPidginSwitchCache();
  });

  it("reads on and off from the server and remembers it", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await getPidginEnabled()).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith("platform_switch_is_on", { p_key: "pidgin_language" });
    expect(mockStore["pidgin-switch-v1"]).toBe("off");
  });

  it("falls back to the last known value when offline", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    await getPidginEnabled();
    clearPidginSwitchCache();
    mockRpc.mockRejectedValue(new Error("offline"));
    expect(await getPidginEnabled()).toBe(false);
  });

  it("assumes on only when the phone has never seen the switch", async () => {
    mockRpc.mockRejectedValue(new Error("offline"));
    expect(await getPidginEnabled()).toBe(true);
  });

  it("does not ask again within the cache window", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await getPidginEnabled();
    await getPidginEnabled();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
