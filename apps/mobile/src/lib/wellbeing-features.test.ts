import { describe, expect, it, jest } from "@jest/globals";

jest.mock("./supabase", () => ({ supabase: {} }));
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: { getItem: async () => null, setItem: async () => undefined } }));

import { featuresCacheKey, resolveWellbeingFeatures, type FeatureIO } from "./wellbeing-features";

function io(over: Partial<FeatureIO> = {}) {
  let saved: string | null = null;
  const base: FeatureIO = {
    fetchOpen: async () => ({ panic: true, insights: false, share: true, insights_hidden: false }),
    read: async () => saved,
    write: async (v) => { saved = v; },
  };
  return { io: { ...base, ...over }, saved: () => saved };
}

describe("wellbeing features on the phone", () => {
  it("returns the server's answer and keeps it for next time", async () => {
    const m = io();
    expect(await resolveWellbeingFeatures(m.io)).toEqual({ panic: true, insights: false, share: true, insightsHidden: false });
    expect(JSON.parse(m.saved() as string)).toEqual({ panic: true, insights: false, share: true, insights_hidden: false });
  });
  it("with no signal, uses the last good answer so the calm tool still opens", async () => {
    const m = io();
    await resolveWellbeingFeatures(m.io);
    const offline = { ...m.io, fetchOpen: async () => { throw new Error("offline"); } };
    expect((await resolveWellbeingFeatures(offline)).panic).toBe(true);
  });
  it("with no signal and nothing saved, everything stays closed", async () => {
    const f = await resolveWellbeingFeatures(io({ fetchOpen: async () => { throw new Error("offline"); } }).io);
    expect(f).toEqual({ panic: false, insights: false, share: false, insightsHidden: false });
  });
  it("a server 'closed' answer replaces an older 'open' one (the guard was switched off)", async () => {
    const m = io();
    await resolveWellbeingFeatures(m.io);
    const closed = { ...m.io, fetchOpen: async () => ({ panic: false, insights: false, share: false, insights_hidden: false }) };
    expect((await resolveWellbeingFeatures(closed)).panic).toBe(false);
    expect((await resolveWellbeingFeatures({ ...m.io, fetchOpen: async () => { throw new Error("offline"); } })).panic).toBe(false);
  });
  it("a malformed answer or a corrupt saved copy fails closed", async () => {
    expect(await resolveWellbeingFeatures(io({ fetchOpen: async () => "yes" }).io)).toEqual({ panic: false, insights: false, share: false, insightsHidden: false });
    const f = await resolveWellbeingFeatures(io({ fetchOpen: async () => { throw new Error("x"); }, read: async () => "{not json" }).io);
    expect(f.panic).toBe(false);
  });
  it("keeps one saved answer per person on a shared phone", () => {
    expect(featuresCacheKey("a")).not.toBe(featuresCacheKey("b"));
  });
});
