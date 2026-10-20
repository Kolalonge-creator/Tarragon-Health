import { describe, expect, it } from "@jest/globals";
import { bpAckDelivery, bpAckWebCode, type BpAckLevel } from "./bp-ack";

describe("bpAckDelivery: only what is true about the blood pressure row at the moment of saving", () => {
  it("the blood pressure row reached the server: received", () => {
    expect(bpAckDelivery({ saved: 3, bpState: "sent" })).toEqual({ kind: "received" });
  });

  it("the blood pressure row is still on the phone (offline): waiting, never received", () => {
    expect(bpAckDelivery({ saved: 3, bpState: "waiting" })).toEqual({ kind: "waiting" });
  });

  it("a row it cannot find is waiting, never received", () => {
    expect(bpAckDelivery({ saved: 3 })).toEqual({ kind: "waiting" });
  });

  it("a blood pressure row the server refused is refused, not waiting (it will not retry), and carries its support code", () => {
    expect(bpAckDelivery({ saved: 3, bpState: "rejected", bpSupportCode: "TH-123" })).toEqual({ kind: "refused", supportCode: "TH-123" });
    expect(bpAckDelivery({ saved: 3, bpState: "rejected" })).toEqual({ kind: "refused", supportCode: null });
    expect(bpAckDelivery({ saved: 3, bpState: "rejected", bpSupportCode: null })).toEqual({ kind: "refused", supportCode: null });
  });

  it("an error, or nothing saved, is not saved: never shown as received or waiting", () => {
    expect(bpAckDelivery({ error: "Couldn't save this on your phone. Try again.", saved: 3, bpState: "sent" })).toEqual({ kind: "not_saved" });
    expect(bpAckDelivery({ saved: 0, bpState: "sent" })).toEqual({ kind: "not_saved" });
    expect(bpAckDelivery({})).toEqual({ kind: "not_saved" });
  });
});

describe("bpAckWebCode: the web names only wording that is true for every adult", () => {
  it.each<[BpAckLevel, string | null]>([
    ["green", null],
    ["amber", null],
    ["red", "TRI-005"],
    ["emergency", "EMG-001"],
    ["unknown", null],
  ])("%s -> %s", (level, code) => {
    expect(bpAckWebCode(level)).toBe(code);
  });
});
