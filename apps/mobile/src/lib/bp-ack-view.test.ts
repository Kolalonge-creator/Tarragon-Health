import { bpAckMessage } from "./bp-ack-view";
import { bpAckDelivery } from "@tarragon/shared";
import { en } from "@tarragon/i18n";

describe("bpAckMessage", () => {
  it("received: says the server has it, and nothing about a person", () => {
    expect(bpAckMessage({ kind: "received" }, "en")).toBe("Received by TarragonHealth. Your reading is saved in your record.");
  });

  it("waiting (offline): says it is on the phone and has NOT reached TarragonHealth", () => {
    const m = bpAckMessage({ kind: "waiting" }, "en");
    expect(m).toBe("Saved on this phone. It will send when you are back online. It has not reached TarragonHealth yet.");
    expect(m).not.toMatch(/received/i);
  });

  it("refused and not saved add no second line (the screen already shows the refusal or the error)", () => {
    expect(bpAckMessage({ kind: "refused", supportCode: "TH-1" }, "en")).toBeNull();
    expect(bpAckMessage({ kind: "not_saved" }, "en")).toBeNull();
    expect(bpAckMessage(null, "en")).toBeNull();
  });

  it("follows the real save outcomes end to end: offline, online, refused, failed", () => {
    expect(bpAckMessage(bpAckDelivery({ saved: 3, syncedAll: false, remaining: 3 }), "en")).toContain("not reached");
    expect(bpAckMessage(bpAckDelivery({ saved: 3, syncedAll: true, remaining: 0 }), "en")).toContain("Received");
    expect(bpAckMessage(bpAckDelivery({ saved: 3, rejectedSupportCodes: ["X"] }), "en")).toBeNull();
    expect(bpAckMessage(bpAckDelivery({ error: "x" }), "en")).toBeNull();
  });
});

describe("the acknowledgement wording never claims a person acted or promises a time", () => {
  const keys = Object.keys(en).filter((k) => k.startsWith("bpack.")) as (keyof typeof en)[];
  it("has the keys", () => {
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });
  it.each(keys)("%s", (k) => {
    const text = String(en[k]);
    expect(text).not.toMatch(/\b(reviewed|seen|read by|looked at|doctor|clinician|nurse|within|hours?|minutes?|soon|shortly|urgent)\b/i);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/—|–/);
  });
});
