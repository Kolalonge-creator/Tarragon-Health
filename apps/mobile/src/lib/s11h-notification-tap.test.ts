/**
 * S11h: tapping the recheck reminder (a local notification) or the server's backup push opens the blood pressure screen,
 * from a cold start and while running; a tap is acted on once; anything else opens nothing.
 */
import { resetHandledNotificationTaps, sectionForNotification, startNotificationTaps, type NotificationResponse, type NotificationTapPort } from "./notification-tap";

describe("sectionForNotification", () => {
  it("the recheck reminder and the older BP reminder open the vitals section", () => {
    expect(sectionForNotification({ kind: "triage_recheck" })).toBe("vitals");
    expect(sectionForNotification({ kind: "bp" })).toBe("vitals");
  });
  it("the server push opens vitals by its web path, including a sub-path or a query", () => {
    expect(sectionForNotification({ url: "/patient/vitals" })).toBe("vitals");
    expect(sectionForNotification({ url: "/patient/vitals/history" })).toBe("vitals");
    expect(sectionForNotification({ url: "/patient/vitals?x=1" })).toBe("vitals");
  });
  it("anything else opens nothing", () => {
    expect(sectionForNotification({ url: "/patient/medications" })).toBeNull();
    expect(sectionForNotification({ url: "/patient/vitalsx" })).toBeNull();
    expect(sectionForNotification({ kind: "dose" })).toBeNull();
    expect(sectionForNotification({})).toBeNull();
    expect(sectionForNotification(null)).toBeNull();
    expect(sectionForNotification("vitals")).toBeNull();
  });
});

function fakePort(last: NotificationResponse | null, fail = false) {
  let handler: ((r: NotificationResponse) => void) | null = null;
  const port: NotificationTapPort & { cleared: number; listeners: () => number } = {
    cleared: 0,
    listeners: () => (handler ? 1 : 0),
    lastResponse: async () => {
      if (fail) throw new Error("native");
      return last;
    },
    onResponse: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    clearLast() {
      this.cleared += 1;
    },
  };
  return { port, tap: (r: NotificationResponse) => handler?.(r) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const recheck = (id = "n1"): NotificationResponse => ({ id, data: { kind: "triage_recheck" } });

beforeEach(() => resetHandledNotificationTaps());

describe("startNotificationTaps", () => {
  it("a tap that launched the app opens vitals once and is cleared", async () => {
    const open = jest.fn();
    const { port } = fakePort(recheck());
    startNotificationTaps(port, open);
    await flush();
    expect(open).toHaveBeenCalledWith("vitals");
    expect(port.cleared).toBe(1);
  });
  it("the same tap seen again (the OS returns the last response on every launch) is not acted on twice", async () => {
    const open = jest.fn();
    const a = fakePort(recheck("same"));
    startNotificationTaps(a.port, open);
    await flush();
    const b = fakePort(recheck("same"));
    startNotificationTaps(b.port, open);
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("a tap while running opens vitals; a tap that is not ours opens nothing", async () => {
    const open = jest.fn();
    const { port, tap } = fakePort(null);
    startNotificationTaps(port, open);
    await flush();
    tap({ id: "x", data: { kind: "dose" } });
    expect(open).not.toHaveBeenCalled();
    tap({ id: "y", data: { url: "/patient/vitals" } });
    expect(open).toHaveBeenCalledWith("vitals");
    expect(port.cleared).toBe(0);
  });
  it("stopping removes the listener and ignores a cold-start answer that arrives late", async () => {
    const open = jest.fn();
    const { port } = fakePort(recheck("late"));
    const stop = startNotificationTaps(port, open);
    stop();
    await flush();
    expect(port.listeners()).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });
  it("a failing native call never throws", async () => {
    const open = jest.fn();
    const { port } = fakePort(null, true);
    expect(() => startNotificationTaps(port, open)).not.toThrow();
    await flush();
    expect(open).not.toHaveBeenCalled();
  });
});
