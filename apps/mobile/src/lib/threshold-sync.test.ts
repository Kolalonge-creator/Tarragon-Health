/**
 * threshold-sync.ts is the ONLY mechanism by which a phone with a stale
 * bundled build finds out the server's clinical thresholds have moved. If
 * its version comparison stops working, every affected handset keeps
 * classifying against whatever it shipped with, indefinitely, and nothing
 * anywhere reports it. These tests exercise that comparison directly and pin
 * the bundled version string against the server's own.
 */
import * as SecureStore from "expo-secure-store";
import { MOBILE_THRESHOLDS_VERSION } from "../../../web/src/lib/vitals/mobile-thresholds";
import { fetchVitalsThresholds } from "./api";
import { BP_THRESHOLDS } from "./bp-classification";
import { GLUCOSE_THRESHOLDS } from "./glucose-red-flags";
import { DEFAULT_VERSION, loadActiveThresholds, syncThresholdsIfOnline } from "./threshold-sync";

jest.mock("./api", () => ({ fetchVitalsThresholds: jest.fn() }));

const mockFetch = fetchVitalsThresholds as jest.MockedFunction<typeof fetchVitalsThresholds>;
const CACHE_KEY = "vitals-thresholds-cache-v1";

/**
 * THE drift channel. threshold-sync.ts's DEFAULT_VERSION is what a freshly
 * installed build compares the server's version against; if the two ever
 * disagree for a reason other than a genuine threshold change, every install
 * re-fetches on every foreground (harmless), and — far worse — if a
 * threshold changes on the server WITHOUT this string being bumped
 * (mobile-thresholds.ts's MOBILE_THRESHOLDS_VERSION is derived from the two
 * source files' own *_VERSION constants), no phone ever notices.
 */
it("bundles exactly the version string the server reports", () => {
  expect(DEFAULT_VERSION).toBe(MOBILE_THRESHOLDS_VERSION);
});

describe("loadActiveThresholds", () => {
  it("falls back to the bundled defaults when nothing has ever synced", async () => {
    await expect(loadActiveThresholds()).resolves.toEqual({
      version: DEFAULT_VERSION,
      glucose: GLUCOSE_THRESHOLDS,
      bp: BP_THRESHOLDS,
    });
  });

  it("returns a previously cached set once one exists", async () => {
    const cached = {
      version: "glucose:9999-01-01.1|bp:9999-01-01.1",
      glucose: { ...GLUCOSE_THRESHOLDS, severeHypo: 2.5 },
      bp: BP_THRESHOLDS,
    };
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(cached));
    await expect(loadActiveThresholds()).resolves.toEqual(cached);
  });

  it.each([
    ["unparseable JSON", "{ not json"],
    ["a cache with no version", JSON.stringify({ glucose: GLUCOSE_THRESHOLDS, bp: BP_THRESHOLDS })],
    ["a cache missing the bp set", JSON.stringify({ version: "v2", glucose: GLUCOSE_THRESHOLDS })],
  ])("falls back to the bundled defaults for %s rather than classifying on junk", async (_label, raw) => {
    await SecureStore.setItemAsync(CACHE_KEY, raw);
    const active = await loadActiveThresholds();
    expect(active.version).toBe(DEFAULT_VERSION);
    expect(active.bp).toEqual(BP_THRESHOLDS);
  });
});

describe("syncThresholdsIfOnline", () => {
  it("detects a server version that differs and caches the new values", async () => {
    mockFetch.mockResolvedValue({
      version: "glucose:2027-01-01.1|bp:2027-01-01.1",
      glucose: { severeHypo: 3.3 },
      bp: { emergency: { systolic: 190, diastolic: 115 } },
    });

    await syncThresholdsIfOnline();
    const active = await loadActiveThresholds();

    expect(active.version).toBe("glucose:2027-01-01.1|bp:2027-01-01.1");
    // The server sent a partial set; the rest must keep the bundled values
    // rather than becoming undefined and silently failing every comparison.
    expect(active.glucose).toEqual({ ...GLUCOSE_THRESHOLDS, severeHypo: 3.3 });
    expect(active.bp).toEqual({ ...BP_THRESHOLDS, emergency: { systolic: 190, diastolic: 115 } });
  });

  it("writes nothing when the server reports the version already active", async () => {
    mockFetch.mockResolvedValue({
      version: DEFAULT_VERSION,
      glucose: { severeHypo: 99 },
      bp: {},
    });

    await syncThresholdsIfOnline();

    expect(await SecureStore.getItemAsync(CACHE_KEY)).toBeNull();
    expect((await loadActiveThresholds()).glucose.severeHypo).toBe(GLUCOSE_THRESHOLDS.severeHypo);
  });

  it("is a harmless no-op offline — never throws, never clears what is cached", async () => {
    mockFetch.mockResolvedValue(null);
    await expect(syncThresholdsIfOnline()).resolves.toBeUndefined();

    mockFetch.mockRejectedValue(new Error("network down"));
    await expect(syncThresholdsIfOnline()).resolves.toBeUndefined();

    expect((await loadActiveThresholds()).version).toBe(DEFAULT_VERSION);
  });
});
