/**
 * Private route recording on the phone (S48b, 5.7), proven with a STUBBED location source (the real one needs expo-location, a new native build).
 */
import { addFix, EMPTY_ROUTE, haversineM, summarise, toGeoJson, ROUTE_MAX_POINTS, type LocationFix, type LocationSource } from "./route-recorder";
import { startRouteSession } from "./route-session";
import { getLocationSource } from "./location-source";

const fix = (lat: number, lon: number, atMs: number, accuracyM?: number | null): LocationFix => ({ latitude: lat, longitude: lon, atMs, accuracyM });

describe("route recorder (pure)", () => {
  it("measures about 111 km per degree of latitude", () => {
    expect(Math.round(haversineM([3.4, 6.0], [3.4, 7.0]) / 1000)).toBe(111);
  });

  it("keeps the first fix and ignores one that has not moved far enough", () => {
    let s = addFix(EMPTY_ROUTE, fix(6.5, 3.3, 0));
    expect(s.points).toHaveLength(1);
    s = addFix(s, fix(6.50001, 3.3, 1000));
    expect(s.points).toHaveLength(1);
  });

  it("adds distance as the person moves and summarises it", () => {
    let s = addFix(EMPTY_ROUTE, fix(6.5, 3.3, 0));
    s = addFix(s, fix(6.501, 3.3, 60_000));
    s = addFix(s, fix(6.502, 3.3, 120_000));
    const sum = summarise(s);
    expect(sum.distanceM).toBeGreaterThan(200);
    expect(sum.durationMinutes).toBe(2);
    expect(summarise(EMPTY_ROUTE)).toEqual({ distanceM: 0, durationMinutes: 0 });
  });

  it("drops vague, impossible and non-finite fixes", () => {
    let s = addFix(EMPTY_ROUTE, fix(6.5, 3.3, 0));
    for (const bad of [fix(6.6, 3.3, 1, 500), fix(91, 3.3, 1), fix(6.6, 181, 1), fix(Number.NaN, 3.3, 1), fix(6.6, 3.3, Number.NaN), fix(6.6, 3.3, 1, Number.NaN)]) {
      s = addFix(s, bad);
    }
    expect(s.points).toHaveLength(1);
  });

  it("never grows past the cap", () => {
    let s = EMPTY_ROUTE;
    for (let i = 0; i < ROUTE_MAX_POINTS + 50; i += 1) s = addFix(s, fix(6 + i * 0.001, 3.3, i));
    expect(s.points).toHaveLength(ROUTE_MAX_POINTS);
  });

  it("needs two points to be a route, and the stored shape is a plain LineString", () => {
    expect(toGeoJson(addFix(EMPTY_ROUTE, fix(6.5, 3.3, 0)))).toBeNull();
    const s = addFix(addFix(EMPTY_ROUTE, fix(6.5, 3.3, 0)), fix(6.51, 3.3, 1000));
    expect(toGeoJson(s)).toEqual({ type: "LineString", coordinates: [[3.3, 6.5], [3.3, 6.51]] });
  });
});

describe("route session with a stubbed location source", () => {
  function stub(): LocationSource & { push: (f: LocationFix) => void; stopped: number } {
    let cb: ((f: LocationFix) => void) | null = null;
    const s = {
      stopped: 0,
      push: (f: LocationFix) => cb?.(f),
      start: async (onFix: (f: LocationFix) => void) => {
        cb = onFix;
      },
      stop: async () => {
        s.stopped += 1;
      },
    };
    return s;
  }

  it("no native location module yet: nothing is recorded and the caller is told", async () => {
    expect(getLocationSource()).toBeNull();
    expect(await startRouteSession(getLocationSource())).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a source that refuses to start records nothing", async () => {
    const refusing: LocationSource = { start: async () => { throw new Error("denied"); }, stop: async () => undefined };
    expect(await startRouteSession(refusing)).toEqual({ ok: false, reason: "refused" });
  });

  it("records, stops and returns the route; fixes after stop are ignored", async () => {
    const src = stub();
    const r = await startRouteSession(src);
    if (!r.ok) throw new Error("should start");
    src.push(fix(6.5, 3.3, 0));
    src.push(fix(6.51, 3.3, 60_000));
    const done = await r.session.stop();
    expect(done.points).toHaveLength(2);
    src.push(fix(6.52, 3.3, 120_000));
    expect(r.session.state().points).toHaveLength(2);
    expect(src.stopped).toBe(1);
  });

  it("discard forgets everything", async () => {
    const src = stub();
    const r = await startRouteSession(src);
    if (!r.ok) throw new Error("should start");
    src.push(fix(6.5, 3.3, 0));
    await r.session.discard();
    expect(r.session.state().points).toHaveLength(0);
  });

  it("a source whose stop throws still stops the session", async () => {
    const flaky: LocationSource = { start: async () => undefined, stop: async () => { throw new Error("x"); } };
    const r = await startRouteSession(flaky);
    if (!r.ok) throw new Error("should start");
    await expect(r.session.stop()).resolves.toBeDefined();
    await expect(r.session.discard()).resolves.toBeUndefined();
  });
});
