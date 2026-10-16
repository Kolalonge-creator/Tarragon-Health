import { bpAckMessage, bpRowState } from "./bp-ack-view";
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
    expect(bpAckMessage(bpAckDelivery({ saved: 3, bpState: "waiting" }), "en")).toContain("not reached");
    expect(bpAckMessage(bpAckDelivery({ saved: 3, bpState: "sent" }), "en")).toContain("Received");
    expect(bpAckMessage(bpAckDelivery({ saved: 3, bpState: "rejected", bpSupportCode: "X" }), "en")).toBeNull();
    expect(bpAckMessage(bpAckDelivery({ error: "x" }), "en")).toBeNull();
  });
});

describe("bpRowState: the blood pressure row itself, not the rows saved with it", () => {
  const rows = [
    { clientId: "pulse-1", state: "pending", supportCode: "P" },
    { clientId: "bp-rej", state: "rejected", supportCode: "TH-9" },
    { clientId: "bp-wait", state: "pending", supportCode: "W" },
  ];

  it("a row no longer in the outbox was accepted by the server", () => {
    expect(bpRowState("bp-sent", rows)).toEqual({ state: "sent", supportCode: null });
  });

  it("a slow pulse row beside it does not make a delivered blood pressure look unsent", () => {
    // the blood pressure row left the outbox; the pulse row is still there
    expect(bpRowState("bp-1", [{ clientId: "pulse-1", state: "pending" }]).state).toBe("sent");
  });

  it("a row still in the outbox is waiting", () => {
    expect(bpRowState("bp-wait", rows)).toEqual({ state: "waiting", supportCode: null });
  });

  it("a rejected row is refused, with its support code (or null when it has none)", () => {
    expect(bpRowState("bp-rej", rows)).toEqual({ state: "rejected", supportCode: "TH-9" });
    expect(bpRowState("x", [{ clientId: "x", state: "rejected" }])).toEqual({ state: "rejected", supportCode: null });
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
