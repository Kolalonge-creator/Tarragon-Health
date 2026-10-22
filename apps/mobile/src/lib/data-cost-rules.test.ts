import {
  BYTES_PER_MB,
  costFigures,
  estimateCostKobo,
  formatNaira,
  DOSE_MISSED_SLACK_MS,
  isUrgentEntry,
  shouldHoldForWifi,
  shouldHoldPullForWifi,
  type ConnectionKind,
} from "./data-cost-rules";
import type { OutboxKind } from "./outbox-rules";
import { connectionKindFromNetInfo } from "./connection-kind";
import { loadDataCostConfig } from "./data-cost-config";

const PRICE = 80; // an arbitrary test price in kobo a megabyte; the real one is config

describe("estimateCostKobo: whole kobo, an estimate", () => {
  it("is zero for no data, and for anything that is not a usable number", () => {
    expect(estimateCostKobo(0, PRICE)).toBe(0);
    expect(estimateCostKobo(-500, PRICE)).toBe(0);
    expect(estimateCostKobo(Number.NaN, PRICE)).toBe(0);
    expect(estimateCostKobo(Number.POSITIVE_INFINITY, PRICE)).toBe(0);
    expect(estimateCostKobo(5_000_000, 0)).toBe(0);
    expect(estimateCostKobo(5_000_000, -1)).toBe(0);
    expect(estimateCostKobo(5_000_000, Number.NaN)).toBe(0);
  });

  it("charges a whole megabyte at exactly the price", () => {
    expect(estimateCostKobo(BYTES_PER_MB, PRICE)).toBe(80);
    expect(estimateCostKobo(10 * BYTES_PER_MB, PRICE)).toBe(800);
  });

  it("rounds to the nearest kobo, half up, never to a fraction", () => {
    // 5,000 bytes at 80 kobo a MB is 0.4 kobo: rounds down to 0.
    expect(estimateCostKobo(5_000, PRICE)).toBe(0);
    // 6,250 bytes is exactly 0.5 kobo: half rounds up.
    expect(estimateCostKobo(6_250, PRICE)).toBe(1);
    // 340,000 bytes is 27.2 kobo.
    expect(estimateCostKobo(340_000, PRICE)).toBe(27);
    // 1,250,000 bytes is exactly 100 kobo.
    expect(estimateCostKobo(1_250_000, PRICE)).toBe(100);
    expect(Number.isInteger(estimateCostKobo(123_457, 83))).toBe(true);
  });

  it("is exact for a very large count and capped, never infinite or negative", () => {
    // 50 GB at 80 kobo a MB: 50,000 MB x 80 = 4,000,000 kobo (N40,000), exactly.
    expect(estimateCostKobo(50_000 * BYTES_PER_MB, PRICE)).toBe(4_000_000);
    const huge = estimateCostKobo(Number.MAX_SAFE_INTEGER, 1_000_000);
    expect(Number.isSafeInteger(huge)).toBe(true);
    expect(huge).toBeGreaterThan(0);
    // A price so large the product would exceed the safe integer range is capped.
    expect(estimateCostKobo(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("formatNaira", () => {
  it("shows kobo exactly, with the naira sign", () => {
    expect(formatNaira(0)).toBe("₦0");
    expect(formatNaira(3)).toBe("₦0.03");
    expect(formatNaira(80)).toBe("₦0.80");
    expect(formatNaira(100)).toBe("₦1");
    expect(formatNaira(1250)).toBe("₦12.50");
    expect(formatNaira(125_000_00)).toBe("₦125,000");
    expect(formatNaira(4_000_000)).toBe("₦40,000");
  });

  it("never shows a negative, a fraction of a kobo or NaN", () => {
    expect(formatNaira(-5)).toBe("₦0");
    expect(formatNaira(Number.NaN)).toBe("₦0");
    expect(formatNaira(Number.POSITIVE_INFINITY)).toBe("₦0");
    expect(formatNaira(12.9)).toBe("₦0.12");
    expect(formatNaira(Number.MAX_SAFE_INTEGER)).toMatch(/^₦[\d,]+\.\d{2}$/);
  });
});

describe("costFigures", () => {
  it("prices the month and the last sync, and says nothing for a sync it has not seen", () => {
    expect(costFigures({ monthBytes: 2_500_000, unplacedBytes: 0, lastSync: { bytes: 125_000, at: 1 } }, PRICE)).toEqual({
      monthKobo: 200,
      lastSyncKobo: 10,
    });
    expect(costFigures({ monthBytes: 0, unplacedBytes: 0, lastSync: null }, PRICE)).toEqual({ monthKobo: 0, lastSyncKobo: null });
  });
});

const KINDS: OutboxKind[] = ["vital", "dose", "symptom", "red_care", "kick_session", "contraction_session", "meal", "activity", "anchor_times", "day_shift", "day_shift_end"];
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const HOLD = 6 * 3_600_000;
const HOUR = 3_600_000;
const SERVER_MISSED = 12 * HOUR;

interface HoldOver {
  kind?: OutboxKind;
  danger?: boolean;
  vitalType?: string | null;
  ageMs?: number;
  dueAgoMs?: number | null;
  wifiOnly?: boolean;
  connection?: ConnectionKind;
  forced?: boolean;
  serverMissedMs?: number;
}
/** Defaults to a weight reading logged a minute ago on mobile data with Wi-Fi only on: the case that IS held. */
const hold = (o: HoldOver = {}) =>
  shouldHoldForWifi({
    wifiOnly: o.wifiOnly ?? true,
    connection: o.connection ?? "cellular",
    entry: {
      kind: o.kind ?? "vital",
      danger: o.danger ?? false,
      vitalType: o.vitalType === undefined ? (o.kind === undefined || o.kind === "vital" ? "weight" : null) : o.vitalType,
      createdAtMs: NOW - (o.ageMs ?? 60_000),
      dueMs: o.dueAgoMs === undefined || o.dueAgoMs === null ? null : NOW - o.dueAgoMs,
    },
    nowMs: NOW,
    maxHoldMs: HOLD,
    serverMissedMs: o.serverMissedMs ?? SERVER_MISSED,
    forced: o.forced,
  });

describe("a kind this file has never heard of is urgent (allow-list, safe by default)", () => {
  it("never waits for Wi-Fi, so a new outbox kind added elsewhere cannot start waiting", () => {
    const unknownKind = "some_future_kind" as OutboxKind;
    expect(isUrgentEntry({ kind: unknownKind, danger: false })).toBe(true);
  });
  it("only a dose log and a meal log may wait", () => {
    const waits = (["vital", "dose", "symptom", "red_care", "kick_session", "contraction_session", "meal", "activity", "anchor_times", "day_shift", "day_shift_end", "birth_plan"] as OutboxKind[]).filter(
      (kind) => kind !== "vital" && !isUrgentEntry({ kind, danger: false }),
    );
    expect(waits.sort()).toEqual(["dose", "meal"]);
  });
});

describe("the urgent override: Wi-Fi only never delays an urgent entry", () => {
  it("only a dose log, a meal log and a weight reading are ever ordinary", () => {
    const ordinary = KINDS.filter((k) => !isUrgentEntry({ kind: k, danger: false, vitalType: "weight" }));
    expect(ordinary.sort()).toEqual(["dose", "meal", "vital"]);
    expect(isUrgentEntry({ kind: "vital", danger: false, vitalType: "weight" })).toBe(false);
  });

  it("every other reading is urgent, flagged or not, because the phone's flag is only as good as its classifier", () => {
    for (const vitalType of ["blood_pressure", "glucose", "pulse", "temperature", "spo2"]) {
      expect(isUrgentEntry({ kind: "vital", danger: false, vitalType })).toBe(true);
    }
    // Not knowing what it is counts as urgent.
    expect(isUrgentEntry({ kind: "vital", danger: false })).toBe(true);
    expect(isUrgentEntry({ kind: "vital", danger: false, vitalType: null })).toBe(true);
  });

  it("a danger-flagged entry is urgent whatever its kind, even a dose or a weight", () => {
    for (const kind of KINDS) expect(isUrgentEntry({ kind, danger: true, vitalType: "weight" })).toBe(true);
    expect(hold({ danger: true })).toBe(false);
    expect(hold({ kind: "dose", danger: true })).toBe(false);
  });

  it.each(["blood_pressure", "glucose", "pulse", "temperature", "spo2"])("a %s reading is never held on mobile data", (vitalType) => {
    expect(hold({ kind: "vital", vitalType })).toBe(false);
  });

  it("symptoms, red-alert answers and pregnancy safety logs go at once on mobile data", () => {
    for (const kind of ["symptom", "red_care", "kick_session", "contraction_session"] as const) {
      expect(hold({ kind })).toBe(false);
    }
  });
});

describe("shouldHoldForWifi", () => {
  it("holds a weight reading and a dose log on known mobile data when Wi-Fi only is on", () => {
    expect(hold()).toBe(true);
    expect(hold({ kind: "dose" })).toBe(true);
    expect(hold({ kind: "dose", dueAgoMs: HOUR })).toBe(true);
  });

  it("holds nothing when the choice is off", () => {
    expect(hold({ wifiOnly: false })).toBe(false);
  });

  it.each<ConnectionKind>(["wifi", "other", "unknown", "none"])("holds nothing on a %s connection (only KNOWN mobile data holds)", (connection) => {
    expect(hold({ connection })).toBe(false);
  });

  it("sends when the patient taps Send now", () => {
    expect(hold({ forced: true })).toBe(false);
    expect(hold({ forced: false })).toBe(true);
  });

  it("stops holding once an entry has waited the cap, well inside the server's 12 hour missed window", () => {
    expect(hold({ ageMs: HOLD - 1 })).toBe(true);
    expect(hold({ ageMs: HOLD })).toBe(false);
    expect(hold({ ageMs: HOLD * 3 })).toBe(false);
    expect(HOLD).toBeLessThan(SERVER_MISSED);
  });

  it("never lets a held dose log land after the server writes 'missed' for that dose", () => {
    // A dose taken late: due 9 hours ago, logged a minute ago. The server marks it missed at 12 hours, so the log must go inside 3 hours less the slack.
    expect(hold({ kind: "dose", dueAgoMs: 9 * HOUR })).toBe(true); // 2 hours of room left
    expect(hold({ kind: "dose", dueAgoMs: 11 * HOUR })).toBe(false); // inside the slack: send now
    expect(hold({ kind: "dose", dueAgoMs: SERVER_MISSED - DOSE_MISSED_SLACK_MS })).toBe(false);
    expect(hold({ kind: "dose", dueAgoMs: SERVER_MISSED - DOSE_MISSED_SLACK_MS - 1 })).toBe(true);
    expect(hold({ kind: "dose", dueAgoMs: SERVER_MISSED + HOUR })).toBe(false);
    // The deadline is the earlier of the two, never later than the entry's own cap.
    expect(hold({ kind: "dose", dueAgoMs: 0, ageMs: HOLD })).toBe(false);
  });

  it("never holds a scheduled dose when the server's missed window is unknown, even one logged long before it is due", () => {
    expect(hold({ kind: "dose", dueAgoMs: HOUR, serverMissedMs: 0 })).toBe(false);
    expect(hold({ kind: "dose", dueAgoMs: -3 * HOUR, serverMissedMs: 0 })).toBe(false);
    expect(hold({ kind: "dose", dueAgoMs: -3 * HOUR })).toBe(true);
    // An as-needed dose has no due time and no missed rule: only the cap applies.
    expect(hold({ kind: "dose", dueAgoMs: null, serverMissedMs: 0 })).toBe(true);
  });

  it("never holds an entry with an unreadable or future time", () => {
    expect(hold({ ageMs: -60_000 })).toBe(false);
    expect(
      shouldHoldForWifi({
        wifiOnly: true,
        connection: "cellular",
        entry: { kind: "dose", danger: false, createdAtMs: Number.NaN },
        nowMs: NOW,
        maxHoldMs: HOLD,
        serverMissedMs: SERVER_MISSED,
      })
    ).toBe(false);
  });
});

describe("shouldHoldPullForWifi", () => {
  it("holds the history read on known mobile data, but never the very first read", () => {
    expect(shouldHoldPullForWifi({ wifiOnly: true, connection: "cellular", hasPulledBefore: true })).toBe(true);
    expect(shouldHoldPullForWifi({ wifiOnly: true, connection: "cellular", hasPulledBefore: false })).toBe(false);
    expect(shouldHoldPullForWifi({ wifiOnly: false, connection: "cellular", hasPulledBefore: true })).toBe(false);
    expect(shouldHoldPullForWifi({ wifiOnly: true, connection: "wifi", hasPulledBefore: true })).toBe(false);
    expect(shouldHoldPullForWifi({ wifiOnly: true, connection: "unknown", hasPulledBefore: true })).toBe(false);
  });
});

describe("connectionKindFromNetInfo", () => {
  it("maps the radio's answer and treats anything unclear as not mobile data", () => {
    expect(connectionKindFromNetInfo("wifi", true)).toBe("wifi");
    expect(connectionKindFromNetInfo("cellular", true)).toBe("cellular");
    expect(connectionKindFromNetInfo("none", false)).toBe("none");
    expect(connectionKindFromNetInfo("cellular", false)).toBe("none");
    expect(connectionKindFromNetInfo("unknown", true)).toBe("unknown");
    expect(connectionKindFromNetInfo(undefined, undefined)).toBe("unknown");
    expect(connectionKindFromNetInfo(null, null)).toBe("unknown");
    // A VPN can ride on mobile data, so it is "unknown" (counted toward the estimate, never a reason to hold); only wired ethernet is free.
    expect(connectionKindFromNetInfo("vpn", true)).toBe("unknown");
    expect(connectionKindFromNetInfo("bluetooth", true)).toBe("unknown");
    expect(connectionKindFromNetInfo("other", true)).toBe("unknown");
    expect(connectionKindFromNetInfo("ethernet", true)).toBe("other");
  });
});

describe("the configured values", () => {
  it("come from the registry as whole numbers, and the hold cap stays inside the 12 hour missed-dose window", () => {
    const c = loadDataCostConfig();
    expect(Number.isInteger(c.pricePerMbKobo)).toBe(true);
    expect(c.pricePerMbKobo).toBeGreaterThan(0);
    expect(c.maxHoldMs).toBeGreaterThan(0);
    expect(c.maxHoldMs).toBeLessThan(12 * 3_600_000);
  });

  it("still loads on a phone whose clock runs behind the date the values took effect (it sits on the sync path)", () => {
    jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask"] });
    try {
      expect(() => loadDataCostConfig()).not.toThrow();
      expect(loadDataCostConfig().pricePerMbKobo).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
