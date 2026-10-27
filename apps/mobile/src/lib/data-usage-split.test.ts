import AsyncStorage from "@react-native-async-storage/async-storage";
import { addDataUsage, getMonthlyDataUsage, getUsageFigures } from "./data-usage";

/** S06z: the meter splits use by connection and remembers the last sync. */
const T0 = new Date("2026-10-13T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("data meter by connection", () => {
  it("counts mobile data toward the figure, keeps Wi-Fi out of it, and still counts every byte in the total", async () => {
    await addDataUsage(1_000, T0, "cellular");
    await addDataUsage(9_000, T0, "wifi");
    await addDataUsage(500, T0, "none");
    await addDataUsage(250, T0, "other");
    const figures = await getUsageFigures(T0);
    expect(figures.monthBytes).toBe(1_000);
    expect(figures.unplacedBytes).toBe(0);
    expect(await getMonthlyDataUsage(T0)).toBe(10_750);
  });

  it("keeps use it cannot place apart, counts it in the figure so the estimate leans high, and reports it", async () => {
    await addDataUsage(2_000, T0, "cellular");
    await addDataUsage(700, T0, "unknown");
    const figures = await getUsageFigures(T0);
    expect(figures.monthBytes).toBe(2_700);
    expect(figures.unplacedBytes).toBe(700);
  });

  it("reads the connection from the phone when none is given, and an unreadable one is unplaced, not mobile data", async () => {
    // Under Jest there is no NetInfo native module, so the phone cannot say: unplaced.
    await addDataUsage(400, T0);
    const figures = await getUsageFigures(T0);
    expect(figures.unplacedBytes).toBe(400);
  });

  it("starts each month at zero", async () => {
    await addDataUsage(5_000, T0, "cellular");
    expect((await getUsageFigures(new Date("2026-11-02T00:00:00Z"))).monthBytes).toBe(0);
  });

  it("is zero for a phone that has never synced", async () => {
    expect(await getUsageFigures(T0)).toEqual({ monthBytes: 0, unplacedBytes: 0, lastSync: null });
  });
});

describe("last sync", () => {
  it("adds uses a few seconds apart into one sync, and starts a new sync after a gap", async () => {
    await addDataUsage(1_000, at(0), "cellular");
    await addDataUsage(2_000, at(5_000), "cellular");
    await addDataUsage(500, at(10_000), "wifi");
    expect((await getUsageFigures(at(10_000))).lastSync).toEqual({ bytes: 3_000, at: at(5_000).getTime() });
    await addDataUsage(700, at(10 * 60_000), "cellular");
    expect((await getUsageFigures(at(10 * 60_000))).lastSync).toEqual({ bytes: 700, at: at(10 * 60_000).getTime() });
  });

  it("a later Wi-Fi sync leaves the last mobile-data sync as it was, never blanks or replaces it", async () => {
    await addDataUsage(4_000, at(0), "cellular");
    await addDataUsage(9_000, at(30 * 60_000), "wifi");
    expect((await getUsageFigures(at(30 * 60_000))).lastSync).toEqual({ bytes: 4_000, at: at(0).getTime() });
  });

  it("survives a corrupt stored record and a failing store without throwing", async () => {
    await AsyncStorage.setItem("@tarragon/data-usage/last", "not json{");
    await addDataUsage(300, T0, "cellular");
    expect((await getUsageFigures(T0)).lastSync?.bytes).toBe(300);

    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValue(new Error("disk"));
    await expect(getUsageFigures(T0)).resolves.toEqual({ monthBytes: 0, unplacedBytes: 0, lastSync: null });
    await expect(addDataUsage(100, T0, "cellular")).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("does not lose counts when syncs report at the same time", async () => {
    await Promise.all(Array.from({ length: 20 }, () => addDataUsage(100, T0, "cellular")));
    expect((await getUsageFigures(T0)).monthBytes).toBe(2_000);
  });
});
