const openShare = jest.fn();
jest.mock("@/lib/my-health/open-share", () => ({
  openShare: (...a: unknown[]) => openShare(...a),
  isWellFormedPin: (p: string) => /^[0-9]{4,12}$/.test(p),
}));
jest.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.7, 10.0.0.1"]]),
}));

import { unlockCounter, type CounterUnlockState } from "./actions";

const START: CounterUnlockState = { status: "pin_required", attemptsLeft: null };
const form = (pin: string) => {
  const f = new FormData();
  f.set("pin", pin);
  return f;
};

beforeEach(() => openShare.mockReset());

describe("unlockCounter", () => {
  it("never calls the database for a malformed PIN, so it cannot burn a miss", async () => {
    expect(await unlockCounter("tok", START, form("12ab"))).toEqual({ status: "pin_required", attemptsLeft: null, message: "format" });
    expect(openShare).not.toHaveBeenCalled();
  });

  it("opens through the counter door, with the PIN and the first forwarded address as the client key", async () => {
    openShare.mockResolvedValue({ kind: "ok", record: { status: "ok", kind: "pharmacy_counter", full_name: "A B" } });
    expect((await unlockCounter("tok", START, form("123456"))).status).toBe("ok");
    expect(openShare).toHaveBeenCalledWith("tok", "123456", "203.0.113.7", "pharmacy_snapshot_by_token");
  });

  it("maps a wrong PIN, a rate limit and a dead link", async () => {
    openShare.mockResolvedValue({ kind: "pin_required", attemptsLeft: 3 });
    expect(await unlockCounter("tok", START, form("123456"))).toEqual({ status: "pin_required", attemptsLeft: 3 });
    openShare.mockResolvedValue({ kind: "try_later" });
    expect((await unlockCounter("tok", START, form("123456"))).status).toBe("try_later");
    openShare.mockResolvedValue({ kind: "unavailable" });
    expect((await unlockCounter("tok", START, form("123456"))).status).toBe("unavailable");
  });
});
