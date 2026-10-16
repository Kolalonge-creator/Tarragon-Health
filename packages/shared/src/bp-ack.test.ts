import { describe, expect, it } from "@jest/globals";
import { bpAckDelivery, bpAckWebCode, type BpAckLevel } from "./bp-ack";

describe("bpAckDelivery: only what is true at the moment of saving", () => {
  it("everything reached the server: received", () => {
    expect(bpAckDelivery({ saved: 3, syncedAll: true, remaining: 0, rejectedSupportCodes: [] })).toEqual({ kind: "received" });
  });

  it("saved on the phone and not sent (offline): waiting, never received", () => {
    expect(bpAckDelivery({ saved: 3, syncedAll: false, remaining: 3 })).toEqual({ kind: "waiting" });
    expect(bpAckDelivery({ saved: 1, remaining: 1 })).toEqual({ kind: "waiting" });
  });

  it("a row the server refused is refused, not waiting (it will not retry), and carries its support code", () => {
    expect(bpAckDelivery({ saved: 3, syncedAll: false, remaining: 1, rejectedSupportCodes: ["TH-123"] })).toEqual({ kind: "refused", supportCode: "TH-123" });
    expect(bpAckDelivery({ saved: 3, syncedAll: false, rejectedSupportCodes: [""] })).toEqual({ kind: "refused", supportCode: "" });
  });

  it("a refused row wins even if syncedAll is wrongly true", () => {
    expect(bpAckDelivery({ saved: 2, syncedAll: true, rejectedSupportCodes: ["X"] })).toEqual({ kind: "refused", supportCode: "X" });
  });

  it("an error, or nothing saved, is not saved: never shown as received or waiting", () => {
    expect(bpAckDelivery({ error: "Couldn't save this on your phone. Try again.", saved: 3, syncedAll: true })).toEqual({ kind: "not_saved" });
    expect(bpAckDelivery({ saved: 0, syncedAll: true })).toEqual({ kind: "not_saved" });
    expect(bpAckDelivery({})).toEqual({ kind: "not_saved" });
  });
});

describe("bpAckWebCode: the web only ever names signed wording", () => {
  it.each<[BpAckLevel, string | null]>([
    ["green", "TRI-001"],
    ["amber", "TRI-003"],
    ["red", "TRI-005"],
    ["emergency", "TRI-005"],
    ["unknown", null],
  ])("%s -> %s", (level, code) => {
    expect(bpAckWebCode(level)).toBe(code);
  });
});
