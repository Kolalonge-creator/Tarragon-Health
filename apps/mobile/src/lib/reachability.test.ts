/**
 * S06x honest reconnect trigger: NetInfo says "connected", a HEAD proves it, at most once a minute,
 * only while entries wait.
 */
import { getMonthlyDataUsage } from "./data-usage";
import { probeReachable, startReconnectWatcher, type WatcherIo } from "./reachability";
import { looksConnected, shouldProbe, type NetState } from "./reachability-rules";

describe("rules", () => {
  it("looks connected only when connected and the OS has not said the internet is unreachable", () => {
    expect(looksConnected({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(looksConnected({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(looksConnected({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(looksConnected({ isConnected: false, isInternetReachable: null })).toBe(false);
    expect(looksConnected({ isConnected: null, isInternetReachable: null })).toBe(false);
  });

  it("probes only while entries wait, and not more than once per interval", () => {
    const base = { minIntervalMs: 60_000, rowsWaiting: 2 };
    expect(shouldProbe({ ...base, now: 0, lastProbeAt: null })).toBe(true);
    expect(shouldProbe({ ...base, now: 59_999, lastProbeAt: 0 })).toBe(false);
    expect(shouldProbe({ ...base, now: 60_000, lastProbeAt: 0 })).toBe(true);
    expect(shouldProbe({ ...base, rowsWaiting: 0, now: 999_999, lastProbeAt: null })).toBe(false);
  });
});

describe("probeReachable", () => {
  it("sends a HEAD with no body and counts any HTTP answer as reachable", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ status: 401 });
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    expect(await probeReachable(1000, fetchImpl as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("/rest/v1/")).toBe(true);
    expect(init.method).toBe("HEAD");
    expect(init.body).toBeUndefined();
  });

  it("is not reachable when the request throws (no data, captive portal, timeout)", async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    const fetchImpl = jest.fn().mockRejectedValue(new Error("Network request failed"));
    expect(await probeReachable(1000, fetchImpl as unknown as typeof fetch)).toBe(false);
  });
});

function makeIo() {
  let listener: ((s: NetState) => void) | null = null;
  let tick: (() => void) | null = null;
  let clock = 1_000_000;
  const probe = jest.fn<Promise<boolean>, [number]>();
  const io: WatcherIo = {
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    probe,
    now: () => clock,
    setInterval: (fn) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      tick = null;
    },
  };
  return {
    io,
    probe,
    emit: (s: NetState) => listener?.(s),
    tick: () => tick?.(),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
const ONLINE: NetState = { isConnected: true, isInternetReachable: true };
const OFFLINE: NetState = { isConnected: false, isInternetReachable: false };
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe("reconnect watcher", () => {
  it("probes when the radio comes back with entries waiting, then flushes once the server answers", async () => {
    const t = makeIo();
    t.probe.mockResolvedValue(true);
    const onReachable = jest.fn().mockResolvedValue(undefined);
    startReconnectWatcher({ rowsWaiting: async () => 2, onReachable }, t.io);
    t.emit(OFFLINE);
    t.emit(ONLINE);
    await flushPromises();
    expect(t.probe).toHaveBeenCalledTimes(1);
    expect(onReachable).toHaveBeenCalledTimes(1);
    expect(await getMonthlyDataUsage()).toBeGreaterThan(0); // the probe is counted in the data meter
  });

  it("never probes with an empty outbox", async () => {
    const t = makeIo();
    startReconnectWatcher({ rowsWaiting: async () => 0, onReachable: jest.fn() }, t.io);
    t.emit(ONLINE);
    await flushPromises();
    expect(t.probe).not.toHaveBeenCalled();
  });

  it("does not flush when the connection is only a claim (the probe fails), and tries again a minute later, no sooner", async () => {
    const t = makeIo();
    t.probe.mockResolvedValue(false);
    const onReachable = jest.fn();
    startReconnectWatcher({ rowsWaiting: async () => 1, onReachable }, t.io);
    t.emit(ONLINE);
    await flushPromises();
    expect(onReachable).not.toHaveBeenCalled();
    expect(t.probe).toHaveBeenCalledTimes(1);

    t.advance(30_000);
    t.tick();
    await flushPromises();
    expect(t.probe).toHaveBeenCalledTimes(1); // still inside the minute

    t.advance(31_000);
    t.probe.mockResolvedValue(true);
    t.tick();
    await flushPromises();
    expect(t.probe).toHaveBeenCalledTimes(2);
    expect(onReachable).toHaveBeenCalledTimes(1);
  });

  it("a flapping signal cannot make it probe more than once a minute", async () => {
    const t = makeIo();
    t.probe.mockResolvedValue(true);
    startReconnectWatcher({ rowsWaiting: async () => 1, onReachable: jest.fn() }, t.io);
    for (let i = 0; i < 5; i++) {
      t.emit(OFFLINE);
      t.emit(ONLINE);
      await flushPromises();
      t.advance(5_000);
    }
    expect(t.probe).toHaveBeenCalledTimes(1);
  });

  it("stops when asked", async () => {
    const t = makeIo();
    t.probe.mockResolvedValue(true);
    const stop = startReconnectWatcher({ rowsWaiting: async () => 1, onReachable: jest.fn() }, t.io);
    stop();
    t.emit(ONLINE);
    await flushPromises();
    expect(t.probe).not.toHaveBeenCalled();
  });
});
