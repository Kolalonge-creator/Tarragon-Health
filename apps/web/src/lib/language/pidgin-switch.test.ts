/**
 * The Pidgin kill switch must fail CLOSED on the web: if the switch cannot be
 * read for any reason, the app shows English (the safe language) rather than
 * Pidgin an admin may have switched off. React's `cache` is a passthrough
 * outside a request, so each call here re-reads.
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ rpc })),
}));

import { getPidginEnabled, PIDGIN_SWITCH_KEY } from "./pidgin-switch";

describe("getPidginEnabled", () => {
  beforeEach(() => rpc.mockReset());

  it("asks for the pidgin_language switch and returns true only when it is on", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await getPidginEnabled()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("platform_switch_is_on", { p_key: PIDGIN_SWITCH_KEY });
    expect(PIDGIN_SWITCH_KEY).toBe("pidgin_language");
  });

  it("is false when an admin has switched it off", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await getPidginEnabled()).toBe(false);
  });

  it("is false on an RPC error, a missing value, or a thrown failure", async () => {
    rpc.mockResolvedValue({ data: true, error: { message: "boom" } });
    expect(await getPidginEnabled()).toBe(false);
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getPidginEnabled()).toBe(false);
    rpc.mockRejectedValue(new Error("network"));
    expect(await getPidginEnabled()).toBe(false);
  });
});
