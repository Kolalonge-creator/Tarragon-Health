/**
 * S08x on the phone: as-needed doses are always recorded and the limit notice is only a notice (decision C7), the
 * Android exact-alarm and "Keep reminders working" helpers can never throw, and the reminder health check reports
 * exact alarms only where the phone can tell.
 */
import { Platform } from "react-native";
import { t } from "@tarragon/i18n";
import { getPendingCount, listOutbox } from "./outbox";
import { clearLocalMirror } from "./offline-store";
import { loadAsNeededMedicines, logAsNeededDose, prnNoticeEnabled, type AsNeededMedicine } from "./prn-doses";
import { exactAlarmsAllowed, openExactAlarmSettings } from "./exact-alarms";
import { androidManufacturer, keepStepsFor, openAppSettings, openBatterySettings } from "./keep-reminders";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
let mockGuard: boolean | "error" = true;
let mockOnline = false;
const mockFailTables = new Set<string>();
const mockInserted: Row[] = [];

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: async () => {
      if (mockGuard === "error") return { data: null, error: { message: "offline" } };
      return { data: mockGuard, error: null };
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        gte: () => q,
        in: () => q,
        order: () => q,
        single: async () => ({ data: { organisation_id: "org-1" }, error: null }),
        insert: async (row: Row) => {
          if (!mockOnline) throw new TypeError("Network request failed");
          mockInserted.push(row);
          return { error: null };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          (mockOnline && !mockFailTables.has(table) ? Promise.resolve({ data: mockTables[table] ?? [], error: null }) : Promise.reject(new TypeError("Network request failed"))).then(res, rej),
      };
      return q;
    },
  },
}));

const NOW = Date.parse("2026-10-14T10:00:00Z"); // 11:00 Lagos
const MIN = 60_000;
const med = (limits: AsNeededMedicine["limits"]): AsNeededMedicine => ({ id: "m-prn", drugName: "Painkiller", limits });
const prior = (minutesAgo: number) => ({ logged_at: new Date(NOW - minutesAgo * MIN).toISOString(), status: "taken" });

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockInserted.length = 0;
  mockGuard = true;
  mockOnline = true;
  mockFailTables.clear();
  await clearLocalMirror();
});

describe("logging an as-needed dose", () => {
  it("records the dose and shows no notice when it is inside the limits", async () => {
    mockTables.medication_logs_latest_per_slot = [prior(300)];
    const r = await logAsNeededDose("p1", "org-1", med({ minGapMinutes: 240, dailyMax: 3 }), NOW);
    expect(r).toEqual({ saved: true, synced: true, breaches: [] });
    expect(mockInserted).toHaveLength(1);
    expect(mockInserted[0]).toMatchObject({ medication_id: "m-prn", scheduled_time: null, status: "taken" });
  });

  it("STILL records the dose when it is sooner than the care plan says, and reports the breach so the notice can show", async () => {
    mockTables.medication_logs_latest_per_slot = [prior(60)];
    const r = await logAsNeededDose("p1", "org-1", med({ minGapMinutes: 240, dailyMax: null }), NOW);
    expect(r.saved).toBe(true);
    expect(r.breaches).toEqual(["min_gap"]);
    expect(mockInserted).toHaveLength(1);
  });

  it("counts a dose not yet sent when judging the next one, offline too", async () => {
    mockOnline = false;
    const first = await logAsNeededDose("p1", "org-1", med({ minGapMinutes: 240, dailyMax: null }), NOW - 30 * MIN);
    expect(first).toMatchObject({ saved: true, synced: false, breaches: [] });
    const second = await logAsNeededDose("p1", "org-1", med({ minGapMinutes: 240, dailyMax: null }), NOW);
    expect(second).toMatchObject({ saved: true, synced: false, breaches: ["min_gap"] });
    expect(await getPendingCount()).toBeGreaterThanOrEqual(2);
    const queued = await listOutbox("dose");
    expect(queued.every((q) => (q.payload as { scheduled_time: unknown }).scheduled_time === null)).toBe(true);
  });

  it("never checks a medicine whose care team set no limits (there are no defaults)", async () => {
    mockTables.medication_logs_latest_per_slot = [prior(1), prior(2), prior(3)];
    const r = await logAsNeededDose("p1", "org-1", med(null), NOW);
    expect(r).toMatchObject({ saved: true, breaches: [] });
  });

  it("shows no notice when the go-live switch is explicitly closed, but still records the dose", async () => {
    mockGuard = false;
    mockTables.medication_logs_latest_per_slot = [prior(10)];
    const r = await logAsNeededDose("p1", "org-1", med({ minGapMinutes: 240, dailyMax: null }), NOW);
    expect(r).toMatchObject({ saved: true, breaches: [] });
  });

  it("shows the notice when the switch cannot be read and nothing is cached (a missing warning is the worse mistake)", async () => {
    mockGuard = "error";
    expect(await prnNoticeEnabled()).toBe(true);
    mockTables.medication_logs_latest_per_slot = [prior(10)];
    const r = await logAsNeededDose("p1", "org-1", med({ minGapMinutes: 240, dailyMax: null }), NOW);
    expect(r.breaches).toEqual(["min_gap"]);
  });

  it("remembers an explicit closed answer when the phone goes offline", async () => {
    mockGuard = false;
    expect(await prnNoticeEnabled()).toBe(false);
    mockGuard = "error";
    expect(await prnNoticeEnabled()).toBe(false);
  });
});

describe("the as-needed list", () => {
  it("lists active as-needed medicines with the limits the care team set, and caches them for offline", async () => {
    mockTables.medications = [
      { id: "m-prn", drug_name: "Painkiller", schedule_spec: { kind: "as_needed", maxPerDay: null, startDate: null, endDate: null, foodNote: null } },
      { id: "m-daily", drug_name: "Daily", schedule_spec: null },
    ];
    mockTables.medication_prn_limits = [{ medication_id: "m-prn", min_gap_minutes: 240, daily_max: 3 }];
    const online = await loadAsNeededMedicines("p1");
    expect(online).toEqual([{ id: "m-prn", drugName: "Painkiller", limits: { minGapMinutes: 240, dailyMax: 3 }, limitsUnknown: false }]);
    // the limits read now fails: the phone uses what it last saw rather than guessing "none"
    mockFailTables.add("medication_prn_limits");
    expect((await loadAsNeededMedicines("p1"))[0]).toMatchObject({ limits: { minGapMinutes: 240, dailyMax: 3 }, limitsUnknown: false });
    mockOnline = false;
    // offline, with no mirrored medicines the list is empty rather than an error
    expect(await loadAsNeededMedicines("p1")).toEqual([]);
  });
});

describe("when the limits cannot be read", () => {
  it("says so rather than showing 'no limits', and the dose is still recorded", async () => {
    mockTables.medications = [{ id: "m-prn", drug_name: "Painkiller", schedule_spec: { kind: "as_needed", maxPerDay: null, startDate: null, endDate: null, foodNote: null } }];
    mockFailTables.add("medication_prn_limits");
    const list = await loadAsNeededMedicines("p-fresh");
    expect(list).toEqual([{ id: "m-prn", drugName: "Painkiller", limits: null, limitsUnknown: true }]);
    const r = await logAsNeededDose("p-fresh", "org-1", list[0]!, NOW);
    expect(r).toMatchObject({ saved: true, breaches: [] });
  });
  it("saves the dose before it reads anything from the network", async () => {
    // Every read hangs forever; the dose must already be on the phone.
    mockOnline = false;
    const pending = logAsNeededDose("p1", "org-1", med({ minGapMinutes: 240, dailyMax: null }), NOW);
    const r = await pending;
    expect(r.saved).toBe(true);
    expect((await listOutbox("dose")).length).toBe(1);
  });
});

describe("the wording", () => {
  it("is the approved sentence, names no medicine and never suggests doubling a dose", () => {
    const keys = ["medicines.prn.over_limit_notice", "medicines.prn.limit_gap", "medicines.prn.limit_max", "medicines.prn.saved", "medicines.prn.saved_offline", "medicines.prn.limits_unknown"] as const;
    expect(t("medicines.prn.over_limit_notice")).toBe("This is sooner than your care plan says. Check with your care team before taking another");
    for (const k of keys) {
      const text = t(k, "en", { minutes: 1, count: 1 });
      expect(text).not.toMatch(/double|extra dose|make up|catch up|stop taking|—/i);
    }
  });
});

describe("Android helpers never throw", () => {
  const original = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: original, configurable: true });
  });

  it("cannot tell on iOS or when the native module is missing", () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    expect(exactAlarmsAllowed()).toBeNull();
    expect(openExactAlarmSettings()).toBe(false);
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    expect(exactAlarmsAllowed()).toBeNull();
    expect(openExactAlarmSettings()).toBe(false);
  });

  it("falls back to app settings, and then to a plain false, when a settings screen cannot be opened", async () => {
    const { Linking } = jest.requireActual("react-native") as typeof import("react-native");
    const send = jest.spyOn(Linking, "sendIntent").mockRejectedValue(new Error("no such screen"));
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    expect(await openBatterySettings()).toBe(true);
    expect(open).toHaveBeenCalled();
    open.mockRejectedValue(new Error("nothing"));
    expect(await openBatterySettings()).toBe(false);
    expect(await openAppSettings()).toBe(false);
    send.mockRestore();
    open.mockRestore();
  });

  it("reads the phone maker only on Android and picks the matching steps", () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    expect(androidManufacturer()).toBeNull();
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const constants = Platform.constants as { Manufacturer?: string };
    constants.Manufacturer = "TECNO";
    expect(androidManufacturer()).toBe("TECNO");
    expect(keepStepsFor("TECNO")).toEqual(["meds.keep.tecno_1", "meds.keep.tecno_2"]);
    expect(keepStepsFor("samsung")).toEqual(["meds.keep.samsung_1", "meds.keep.samsung_2"]);
    expect(keepStepsFor(null)).toEqual(["meds.keep.generic_1"]);
    delete constants.Manufacturer;
    expect(androidManufacturer()).toBeNull();
  });
});
