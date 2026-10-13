const openShare = jest.fn();
jest.mock("@/lib/my-health/open-share", () => ({
  openShare: (...a: unknown[]) => openShare(...a),
  isWellFormedPin: (p: string) => /^[0-9]{4,12}$/.test(p),
}));
jest.mock("next/headers", () => ({
  headers: async () => new Map([["x-forwarded-for", "203.0.113.7, 10.0.0.1"]]),
}));

import { unlockShare, type UnlockState } from "./actions";

const START: UnlockState = { status: "pin_required", attemptsLeft: null };
const form = (pin: string) => {
  const f = new FormData();
  f.set("pin", pin);
  return f;
};

beforeEach(() => openShare.mockReset());

describe("unlockShare", () => {
  it("does not call the database for a malformed PIN (so it cannot burn a miss)", async () => {
    const r = await unlockShare("tok", START, form("12ab"));
    expect(r).toEqual({ status: "pin_required", attemptsLeft: null, message: "format" });
    expect(openShare).not.toHaveBeenCalled();
  });

  it("passes the first address in x-forwarded-for as the client key", async () => {
    openShare.mockResolvedValue({ kind: "pin_required", attemptsLeft: 4 });
    const r = await unlockShare("tok", START, form("123456"));
    expect(openShare).toHaveBeenCalledWith("tok", "123456", "203.0.113.7");
    expect(r).toEqual({ status: "pin_required", attemptsLeft: 4 });
  });

  it("returns the record when the PIN is right", async () => {
    openShare.mockResolvedValue({ kind: "ok", record: { status: "ok", full_name: "A B" } });
    const r = await unlockShare("tok", START, form("123456"));
    expect(r.status).toBe("ok");
  });

  it("maps a locked or dead link to unavailable and a rate limit to try_later", async () => {
    openShare.mockResolvedValue({ kind: "unavailable" });
    expect((await unlockShare("tok", START, form("123456"))).status).toBe("unavailable");
    openShare.mockResolvedValue({ kind: "try_later" });
    expect((await unlockShare("tok", START, form("123456"))).status).toBe("try_later");
  });
});
