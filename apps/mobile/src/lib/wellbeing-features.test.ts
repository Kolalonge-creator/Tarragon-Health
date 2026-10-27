import { describe, expect, it, jest } from "@jest/globals";

jest.mock("./supabase", () => ({ supabase: {} }));
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: { getItem: async () => null, setItem: async () => undefined } }));

import { FeatureRefusedError, featuresCacheKey, isServerRefusal, resolveWellbeingFeatures, type FeatureIO } from "./wellbeing-features";

const DAY = 86_400_000;
const OPEN = { panic: true, insights: true, share: true, insights_hidden: false, worklist: true, worklist_activity_opt_out: false };
const CLOSED = { panic: false, insights: false, share: false, insights_hidden: false, worklist: false, worklist_activity_opt_out: false };

function io(over: Partial<FeatureIO> = {}, clock = { t: 1_000_000_000_000 }) {
  let saved: string | null = null;
  const base: FeatureIO = {
    fetchOpen: async () => OPEN,
    read: async () => saved,
    write: async (v) => { saved = v; },
    now: () => clock.t,
  };
  return { io: { ...base, ...over }, saved: () => saved, clock };
}
const offline: Partial<FeatureIO> = { fetchOpen: async () => { throw new Error("Network request failed"); } };

describe("wellbeing features on the phone", () => {
  it("returns the server's answer and keeps it for next time", async () => {
    const m = io();
    expect((await resolveWellbeingFeatures(m.io, 30)).share).toBe(true);
    expect(JSON.parse(m.saved() as string).raw).toEqual(OPEN);
  });
  it("with no signal it uses the saved answer while it is fresh", async () => {
    const m = io();
    await resolveWellbeingFeatures(m.io, 30);
    m.clock.t += 5 * DAY;
    const f = await resolveWellbeingFeatures({ ...m.io, ...offline }, 30);
    expect(f).toMatchObject({ panic: true, share: true, insights: true });
  });
  it("a saved OPEN answer for share and patterns stops being trusted after the limit, but the calm tool keeps its own", async () => {
    const m = io();
    await resolveWellbeingFeatures(m.io, 30);
    m.clock.t += 31 * DAY;
    const f = await resolveWellbeingFeatures({ ...m.io, ...offline }, 30);
    expect(f).toMatchObject({ panic: true, share: false, insights: false, worklist: false });
  });
  it("with no signal and nothing saved, everything stays closed", async () => {
    const f = await resolveWellbeingFeatures(io(offline).io, 30);
    expect(f).toMatchObject(parse(CLOSED));
  });
  it("a saved CLOSED answer can only give closed", async () => {
    const m = io({ fetchOpen: async () => CLOSED });
    await resolveWellbeingFeatures(m.io, 30);
    expect(await resolveWellbeingFeatures({ ...m.io, ...offline }, 30)).toMatchObject(parse(CLOSED));
  });
  it("a server 'closed' answer replaces an older 'open' one", async () => {
    const m = io();
    await resolveWellbeingFeatures(m.io, 30);
    await resolveWellbeingFeatures({ ...m.io, fetchOpen: async () => CLOSED }, 30);
    expect((await resolveWellbeingFeatures({ ...m.io, ...offline }, 30)).panic).toBe(false);
  });
  it("an answer the server REFUSES (an expired session) closes everything and is never covered by the saved copy", async () => {
    const m = io();
    await resolveWellbeingFeatures(m.io, 30);
    const f = await resolveWellbeingFeatures({ ...m.io, fetchOpen: async () => { throw new FeatureRefusedError("JWT expired"); } }, 30);
    expect(f).toMatchObject(parse(CLOSED));
  });
  it("a malformed answer or a corrupt saved copy fails closed", async () => {
    expect(await resolveWellbeingFeatures(io({ fetchOpen: async () => "yes" }).io, 30)).toMatchObject(parse(CLOSED));
    expect((await resolveWellbeingFeatures(io({ ...offline, read: async () => "{not json" }).io, 30)).panic).toBe(false);
  });
  it("keeps one saved answer per person on a shared phone", () => {
    expect(featuresCacheKey("a")).not.toBe(featuresCacheKey("b"));
  });
});

function parse(raw: typeof CLOSED) {
  return { panic: raw.panic, insights: raw.insights, share: raw.share, insightsHidden: raw.insights_hidden, worklist: raw.worklist, worklistActivityOptOut: raw.worklist_activity_opt_out };
}

describe("what counts as the server refusing", () => {
  const res = (status: number, code: string | null, message = "x") => ({ status, error: { code, message } });
  it("a 401 or 403 is a refusal", () => {
    expect(isServerRefusal(res(401, ""))).toBe(true);
    expect(isServerRefusal(res(403, ""))).toBe(true);
  });
  it("explicit authentication errors are a refusal", () => {
    expect(isServerRefusal(res(400, "PGRST301"))).toBe(true);
    expect(isServerRefusal(res(400, "", "JWT expired"))).toBe(true);
  });
  it("502, 503 and 504 are an outage, not a refusal, so the calm tool keeps its saved answer", () => {
    for (const status of [500, 502, 503, 504]) expect(isServerRefusal(res(status, "", "Bad gateway"))).toBe(false);
    expect(isServerRefusal(res(503, "PGRST000"))).toBe(false);
  });
  it("a network failure (no status) is not a refusal", () => {
    expect(isServerRefusal({ status: 0, error: { code: "", message: "TypeError: Network request failed" } })).toBe(false);
    expect(isServerRefusal({ error: { message: "Network request failed" } })).toBe(false);
  });
  it("no error is no refusal", () => {
    expect(isServerRefusal({ status: 200, error: null })).toBe(false);
  });
});
