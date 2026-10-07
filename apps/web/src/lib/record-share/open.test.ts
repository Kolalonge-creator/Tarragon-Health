import { openShare, type ShareOpenClient } from "./open";

const TOKEN = "ab".repeat(32);

function client(data: unknown, error: { message: string } | null = null) {
  const rpc = jest.fn(async () => ({ data, error }));
  return { client: { rpc } as unknown as ShareOpenClient, rpc };
}

describe("openShare", () => {
  it("never asks the database about something that cannot be a token", async () => {
    const { client: c, rpc } = client({ status: "ok" });
    for (const bad of ["", "short", "x".repeat(200), "has space " + "a".repeat(40), "../../etc/passwd" + "a".repeat(30)]) {
      expect(await openShare(bad, null, c)).toEqual({ status: "not_found" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is not found when no client can be made (missing env)", async () => {
    expect(await openShare(TOKEN, null, null)).toEqual({ status: "not_found" });
  });

  it("passes the PIN only when it is 1 to 8 digits", async () => {
    const { client: c, rpc } = client({ status: "pin_required" });
    await openShare(TOKEN, "4821", c);
    expect(rpc).toHaveBeenLastCalledWith("record_share_open", { p_token: TOKEN, p_pin: "4821" });
    await openShare(TOKEN, "48 21", c);
    expect(rpc).toHaveBeenLastCalledWith("record_share_open", { p_token: TOKEN });
    await openShare(TOKEN, "123456789", c);
    expect(rpc).toHaveBeenLastCalledWith("record_share_open", { p_token: TOKEN });
    await openShare(TOKEN, null, c);
    expect(rpc).toHaveBeenLastCalledWith("record_share_open", { p_token: TOKEN });
  });

  it("returns the status the database gave", async () => {
    expect(await openShare(TOKEN, null, client({ status: "gone", reason: "expired" }).client)).toEqual({ status: "gone", reason: "expired" });
    expect(await openShare(TOKEN, null, client({ status: "locked" }).client)).toEqual({ status: "locked" });
  });

  it("reads a database error as not found, never as a guess about the link", async () => {
    expect(await openShare(TOKEN, null, client(null, { message: "boom" }).client)).toEqual({ status: "not_found" });
  });
});
