import { describe, expect, it } from "@jest/globals";
import {
  createAfricasTalkingPhone,
  createMemoryBridgeStore,
  handleAfricasTalkingCallback,
  type BridgeStore,
  type FetchLike,
  type PhoneBridgeProvider,
} from "../../../supabase/functions/_shared/integrations/index.ts";
import { runPhoneContract } from "./contracts/phone.contract";

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const PATIENT = "+2348031234567";
const DOCTOR = "+2348097654321";
const OURS = "+2342013330000";

interface Seen { url: string; method: string; headers: Record<string, string>; body: string | undefined }

/** Answers with the shapes in Africa's Talking's published Voice API. Not Africa's Talking. */
function fakeAt(clock = { now: 1_800_000_000_000 }) {
  const calls: Seen[] = [];
  let failNext = false;
  let reply: { status: number; body: unknown } | null = null;
  let seq = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    if (failNext) {
      failNext = false;
      throw new TypeError("fetch failed");
    }
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = reply ?? { status: 201, body: { errorMessage: "None", entries: [{ phoneNumber: new URLSearchParams(init.body).get("to"), status: "Queued", sessionId: `ATVId_${(seq += 1)}` }] } };
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.body) };
  };
  return { fetch: fetchImpl, calls, clock, failNextCall: () => (failNext = true), replyWith: (status: number, body: unknown) => (reply = { status, body }), reset: () => (reply = null) };
}

function make(opts: { sandbox?: boolean; callerNumber?: string; store?: BridgeStore } = {}) {
  const at = fakeAt();
  const store = opts.store ?? createMemoryBridgeStore();
  const provider = createAfricasTalkingPhone({
    username: "tarragon", apiKey: "secret-api-key", callerNumber: opts.callerNumber ?? OURS, sandbox: opts.sandbox, fetch: at.fetch, store, now: () => at.clock.now,
  });
  return { at, store, provider };
}

// The shared contract. Africa's Talking cannot report the second call being answered on its own, so the answer and failed-leg drivers
// are left out (those two contract cases skip); the adapter's own tests below cover the same states through the callback.
runPhoneContract(
  "africa's talking adapter over a fake vendor",
  () => {
    const { at, provider } = make();
    let dropNext = false;
    const dropped = async <T>(real: () => Promise<T>) => {
      if (dropNext) {
        dropNext = false;
        return { ok: false, error: { code: "network", message: "Could not reach the vendor", retryable: true } } as unknown as T;
      }
      return real();
    };
    const wrapped: PhoneBridgeProvider = {
      name: provider.name,
      isMock: provider.isMock,
      connect: (i) => (dropNext ? dropped(() => provider.connect(i)) : provider.connect(i)),
      status: (id) => dropped(() => provider.status(id)),
      hangup: (id, who) => dropped(() => provider.hangup(id, who)),
    };
    return {
      provider: wrapped,
      advanceMs: (ms) => (at.clock.now += ms),
      failNextCall: () => {
        // a vendor failure on the next network call, or the next call at all, whichever comes first (status and hangup make none)
        dropNext = true;
      },
    };
  },
  () => 1_800_000_000_000,
);

describe("africa's talking adapter", () => {
  it("places the first call to the patient only, form encoded, with our key, from our number and tagged with the bridge id", async () => {
    const { at, provider } = make();
    const r = await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = at.calls[0]!;
    expect(c.url).toBe("https://voice.africastalking.com/call");
    expect(c.method).toBe("POST");
    expect(c.headers["apiKey"]).toBe("secret-api-key");
    expect(c.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(c.body);
    expect(Object.fromEntries(form)).toEqual({ username: "tarragon", from: OURS, to: PATIENT, clientRequestId: r.data.bridgeId });
    // the clinician's number is not sent to the vendor in the first call at all
    expect(c.body).not.toContain(DOCTOR.slice(4));
  });

  it("uses the sandbox host when asked", async () => {
    const { at, provider } = make({ sandbox: true });
    await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 5 });
    expect(at.calls[0]!.url).toBe("https://voice.sandbox.africastalking.com/call");
  });

  it("is not configured without a valid calling number or credentials, and says so without a vendor call", async () => {
    for (const callerNumber of ["", "0201333", "not a number"]) {
      const { at, provider } = make({ callerNumber });
      expect(await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 5 })).toMatchObject({ ok: false, error: { code: "not_configured" } });
      expect(at.calls).toHaveLength(0);
    }
    const noKey = createAfricasTalkingPhone({ username: "", apiKey: "", callerNumber: OURS, fetch: fakeAt().fetch, store: createMemoryBridgeStore() });
    expect(await noKey.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 5 })).toMatchObject({ ok: false, error: { code: "not_configured" } });
  });

  it("closes the bridge as failed and scrubs any number out of the vendor's words when the call is rejected", async () => {
    const { at, provider, store } = make();
    at.replyWith(201, { errorMessage: "None", entries: [{ phoneNumber: PATIENT, status: `Rejected for ${PATIENT}` }] });
    const r = await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("803123");
    expect(JSON.stringify(r)).toContain("[number]");
    expect(await store.findLiveByEncounter(ENC, at.clock.now)).toBeNull();
  });

  it("treats a vendor error message, a missing session id and an empty reply as a refused call", async () => {
    for (const body of [{ errorMessage: "Insufficient balance", entries: [] }, { errorMessage: "None", entries: [{ status: "Queued" }] }, { entries: [{ status: "Queued", sessionId: "" }] }, {}]) {
      const { at, provider } = make();
      at.replyWith(201, body);
      expect(await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 })).toMatchObject({ ok: false, error: { code: "vendor_error", retryable: false } });
    }
  });

  it("maps a vendor HTTP failure to a result, scrubbed, and marks the bridge failed (the number is then forgotten)", async () => {
    const { at, provider, store } = make();
    at.replyWith(401, { message: `bad key for ${PATIENT}` });
    const r = await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    expect(r).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(JSON.stringify(r)).not.toContain("803123");
    expect(await store.findLiveByEncounter(ENC, at.clock.now)).toBeNull();
    at.replyWith(503, {});
    expect(await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 })).toMatchObject({ ok: false, error: { retryable: true } });
  });

  it("answers a failure of its own store as a retryable result, never an exception", async () => {
    const real = createMemoryBridgeStore();
    const broken = (method: keyof BridgeStore): BridgeStore => ({ ...real, [method]: async () => { throw new Error("db down"); } }) as BridgeStore;
    for (const method of ["findLiveByEncounter", "create"] as const) {
      const { provider, at } = make({ store: broken(method) });
      expect(await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 })).toMatchObject({ ok: false, error: { code: "vendor_error", retryable: true } });
      expect(at.calls).toHaveLength(0);
    }
    const linkFails = make({ store: { ...real, update: async (id, patch) => { if (patch.providerSessionId) throw new Error("db down"); return real.update(id, patch); } } });
    expect(await linkFails.provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 })).toMatchObject({ ok: false, error: { retryable: true } });
    const status = make({ store: broken("get") });
    expect(await status.provider.status("br_000000000000000000000000")).toMatchObject({ ok: false });
    expect(await status.provider.hangup("br_000000000000000000000000", "system")).toMatchObject({ ok: false });
    const closeFails = make({ store: { ...createMemoryBridgeStore(), update: async () => { throw new Error("db down"); } } });
    const r = await closeFails.provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    expect(r.ok).toBe(false);
  });

  it("reports hangup failure when the record cannot be closed", async () => {
    const real = createMemoryBridgeStore();
    const m = make({ store: { ...real, update: async (id, patch) => { if (patch.state === "ended") throw new Error("db down"); return real.update(id, patch); } } });
    const r = await m.provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    if (!r.ok) throw new Error("connect");
    expect(await m.provider.hangup(r.data.bridgeId, "patient")).toMatchObject({ ok: false });
  });

  it("walks ringing, then connected through the callback, and forgets the clinician's number when the call ends", async () => {
    const { at, provider, store } = make();
    const r = await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    if (!r.ok) throw new Error("connect");
    const id = r.data.bridgeId;
    expect(await provider.status(id)).toEqual({ ok: true, data: { state: "ringing", patientAnswered: false, clinicianAnswered: false } });
    const cb = { store, callerNumber: OURS, now: () => at.clock.now };
    const answered = await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: id, sessionId: "ATVId_1" }, cb);
    expect(answered.xml).toBe(`<?xml version="1.0" encoding="UTF-8"?><Response><Dial phoneNumbers="${DOCTOR}" callerId="${OURS}" record="false" sequential="false" maxDuration="1800"/></Response>`);
    expect(await provider.status(id)).toEqual({ ok: true, data: { state: "connected", patientAnswered: true, clinicianAnswered: true } });
    expect((await store.get(id))?.clinicianPhone).toBe(DOCTOR);
    await handleAfricasTalkingCallback({ isActive: "0", clientRequestId: id }, cb);
    expect(await provider.status(id)).toMatchObject({ ok: true, data: { state: "ended" } });
    expect((await store.get(id))?.clinicianPhone).toBeNull();
  });

  it("dials the clinician at most once however many times the vendor repeats the callback", async () => {
    const { at, provider, store } = make();
    const r = await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    if (!r.ok) throw new Error("connect");
    const cb = { store, callerNumber: OURS, now: () => at.clock.now };
    const results = await Promise.all([1, 2, 3].map(() => handleAfricasTalkingCallback({ isActive: "1", clientRequestId: r.data.bridgeId }, cb)));
    expect(results.filter((x) => x.xml.includes("<Dial")).length).toBe(1);
    expect(results.filter((x) => x.xml.includes("<Reject/>")).length).toBe(2);
  });

  it("finds the bridge by the vendor's session id when the callback carries no request id", async () => {
    const { at, provider, store } = make();
    const r = await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 });
    if (!r.ok) throw new Error("connect");
    const sessionId = (await store.get(r.data.bridgeId))?.providerSessionId;
    const res = await handleAfricasTalkingCallback({ isActive: "1", sessionId: sessionId ?? "" }, { store, callerNumber: OURS, now: () => at.clock.now });
    expect(res.xml).toContain("<Dial");
  });

  it("rejects a callback for an unknown bridge, a malformed id, a finished or expired bridge, a bad flag and a bad calling number, changing nothing", async () => {
    const { at, provider, store } = make();
    const r = await provider.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 5 });
    if (!r.ok) throw new Error("connect");
    const cb = { store, callerNumber: OURS, now: () => at.clock.now };
    const reject = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
    expect((await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: "br_ffffffffffffffffffffffff" }, cb)).xml).toBe(reject);
    expect((await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: "not-a-bridge" }, cb)).xml).toBe(reject);
    expect((await handleAfricasTalkingCallback({ isActive: "1" }, cb)).xml).toBe(reject);
    expect((await handleAfricasTalkingCallback({ isActive: "1", sessionId: "ATVId_unknown" }, cb)).xml).toBe(reject);
    expect((await handleAfricasTalkingCallback({ isActive: "maybe", clientRequestId: r.data.bridgeId }, cb)).xml).toBe(reject);
    expect((await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: r.data.bridgeId }, { ...cb, callerNumber: "nope" })).xml).toBe(reject);
    expect((await store.get(r.data.bridgeId))?.clinicianDialled).toBe(false);
    at.clock.now += 6 * 60_000;
    expect((await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: r.data.bridgeId }, cb)).xml).toBe(reject);
    expect((await store.get(r.data.bridgeId))?.state).toBe("ended");
    expect((await store.get(r.data.bridgeId))?.clinicianPhone).toBeNull();
  });

  it("never answers a callback with an empty reply or an exception when its store fails (an empty reply aborts the call)", async () => {
    const reject = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
    const broken: BridgeStore = { ...createMemoryBridgeStore(), get: async () => { throw new Error("db down"); } };
    expect((await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: "br_aaaaaaaaaaaaaaaaaaaaaaaa" }, { store: broken, callerNumber: OURS })).xml).toBe(reject);
  });

  it("uses the real clock when none is given", async () => {
    const at = fakeAt();
    const p = createAfricasTalkingPhone({ username: "u", apiKey: "k", callerNumber: OURS, fetch: at.fetch, store: createMemoryBridgeStore() });
    const r = await p.connect({ encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 5 });
    expect(r.ok && r.data.expiresAtMs).toBeGreaterThan(Date.now());
    const store = createMemoryBridgeStore();
    await store.create({ bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: DOCTOR, providerSessionId: "S1", state: "ringing", patientAnswered: false, clinicianDialled: false, startedAtMs: Date.now(), expiresAtMs: Date.now() + 60_000 });
    expect((await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: "br_aaaaaaaaaaaaaaaaaaaaaaaa" }, { store, callerNumber: OURS })).xml).toContain("<Dial");
  });
});

describe("one live bridge per consultation", () => {
  const input = { encounterRef: ENC, patientPhone: PATIENT, clinicianPhone: DOCTOR, maxMinutes: 30 };
  const rec = (over = {}) => ({ bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: DOCTOR, providerSessionId: "S1", state: "ringing" as const, patientAnswered: false, clinicianDialled: false, startedAtMs: 1_800_000_000_000, expiresAtMs: 1_800_000_000_000 + 30 * 60_000, ...over });

  it("uses the bridge another caller created in the same instant instead of ringing anyone twice", async () => {
    const real = createMemoryBridgeStore();
    const { at, provider } = make({ store: { ...real, create: async (r) => { await real.create({ ...r, bridgeId: "br_bbbbbbbbbbbbbbbbbbbbbbbb", providerSessionId: "S9" }); return false; } } });
    const r = await provider.connect(input);
    expect(r.ok && r.data.bridgeId).toBe("br_bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(at.calls).toHaveLength(0);
  });

  it("reports a retryable conflict when the create was refused and no live bridge can be found", async () => {
    const { at, provider } = make({ store: { ...createMemoryBridgeStore(), create: async () => false } });
    expect(await provider.connect(input)).toMatchObject({ ok: false, error: { code: "conflict", retryable: true } });
    expect(at.calls).toHaveLength(0);
  });

  it("closes a bridge that is past its limit before making a new one, and forgets its number", async () => {
    const store = createMemoryBridgeStore();
    await store.create(rec({ expiresAtMs: 1_800_000_000_000 - 1 }));
    const { provider } = make({ store });
    const r = await provider.connect(input);
    expect(r.ok && r.data.bridgeId).not.toBe("br_aaaaaaaaaaaaaaaaaaaaaaaa");
    const old = await store.get("br_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(old).toMatchObject({ state: "ended", clinicianPhone: null });
  });

  it("closes a bridge that never reached the vendor after 30 seconds, but keeps a young one", async () => {
    const stale = createMemoryBridgeStore();
    await stale.create(rec({ providerSessionId: null, startedAtMs: 1_800_000_000_000 - 31_000 }));
    expect((await make({ store: stale }).provider.connect(input)).ok).toBe(true);
    expect((await stale.get("br_aaaaaaaaaaaaaaaaaaaaaaaa"))?.state).toBe("ended");
    const young = createMemoryBridgeStore();
    await young.create(rec({ providerSessionId: null, startedAtMs: 1_800_000_000_000 - 5_000 }));
    const r = await make({ store: young }).provider.connect(input);
    expect(r.ok && r.data.bridgeId).toBe("br_aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("answers a failure to sweep as a retryable result, with no vendor call", async () => {
    const { at, provider } = make({ store: { ...createMemoryBridgeStore(), expireStale: async () => { throw new Error("db down"); } } });
    expect(await provider.connect(input)).toMatchObject({ ok: false, error: { retryable: true } });
    expect(at.calls).toHaveLength(0);
  });

  it("sets the dial's own time limit to what is left on the bridge, never less than a minute", async () => {
    const store = createMemoryBridgeStore();
    await store.create(rec({ expiresAtMs: 1_800_000_000_000 + 10_000 }));
    const r = await handleAfricasTalkingCallback({ isActive: "1", clientRequestId: "br_aaaaaaaaaaaaaaaaaaaaaaaa" }, { store, callerNumber: OURS, now: () => 1_800_000_000_000 });
    expect(r.xml).toContain('maxDuration="60"');
  });
});

describe("the in-memory bridge store", () => {
  const rec = (over = {}) => ({ bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: DOCTOR, providerSessionId: null, state: "ringing" as const, patientAnswered: false, clinicianDialled: false, startedAtMs: 1000, expiresAtMs: 2000, ...over });

  it("forgets the number on a bridge created already finished, and on update to ended or failed", async () => {
    const s = createMemoryBridgeStore();
    await s.create(rec({ bridgeId: "br_bbbbbbbbbbbbbbbbbbbbbbbb", state: "failed" }));
    expect((await s.get("br_bbbbbbbbbbbbbbbbbbbbbbbb"))?.clinicianPhone).toBeNull();
    await s.create(rec());
    await s.update("br_aaaaaaaaaaaaaaaaaaaaaaaa", { state: "failed" });
    expect((await s.get("br_aaaaaaaaaaaaaaaaaaaaaaaa"))?.clinicianPhone).toBeNull();
    await expect(s.update("br_cccccccccccccccccccccccc", { state: "ended" })).resolves.toBeUndefined();
  });

  it("finds a live bridge only while it is ringing or connected and inside its limit", async () => {
    const s = createMemoryBridgeStore();
    await s.create(rec());
    expect(await s.findLiveByEncounter(ENC, 1500)).not.toBeNull();
    expect(await s.findLiveByEncounter(ENC, 2000)).toBeNull();
    expect(await s.findLiveByEncounter("2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97", 1500)).toBeNull();
    expect(await s.findBySession("nope")).toBeNull();
  });

  it("refuses a second live bridge for the same encounter, expired or not, until the first is closed", async () => {
    const s = createMemoryBridgeStore();
    expect(await s.create(rec())).toBe(true);
    expect(await s.create(rec({ bridgeId: "br_bbbbbbbbbbbbbbbbbbbbbbbb" }))).toBe(false);
    await s.update("br_aaaaaaaaaaaaaaaaaaaaaaaa", { state: "ended" });
    expect(await s.create(rec({ bridgeId: "br_bbbbbbbbbbbbbbbbbbbbbbbb" }))).toBe(true);
  });

  it("closes only this encounter's stale live bridges", async () => {
    const s = createMemoryBridgeStore();
    await s.create(rec({ expiresAtMs: 1500 }));
    await s.create(rec({ bridgeId: "br_cccccccccccccccccccccccc", encounterRef: "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97", expiresAtMs: 1500 }));
    await s.expireStale(ENC, 2000);
    expect((await s.get("br_aaaaaaaaaaaaaaaaaaaaaaaa"))?.state).toBe("ended");
    expect((await s.get("br_cccccccccccccccccccccccc"))?.state).toBe("ringing");
  });

  it("lets only one caller claim the dial, and nobody once it is over, expired or has no number", async () => {
    const s = createMemoryBridgeStore();
    await s.create(rec());
    expect(await s.claimDial("br_aaaaaaaaaaaaaaaaaaaaaaaa", 1500)).toBe(DOCTOR);
    expect(await s.claimDial("br_aaaaaaaaaaaaaaaaaaaaaaaa", 1500)).toBeNull();
    expect(await s.claimDial("br_dddddddddddddddddddddddd", 1500)).toBeNull();
    await s.create(rec({ bridgeId: "br_eeeeeeeeeeeeeeeeeeeeeeee", encounterRef: "11111111-1111-4111-8111-111111111111" }));
    expect(await s.claimDial("br_eeeeeeeeeeeeeeeeeeeeeeee", 5000)).toBeNull();
    await s.create(rec({ bridgeId: "br_ffffffffffffffffffffffff", encounterRef: "22222222-2222-4222-8222-222222222222", clinicianPhone: null }));
    expect(await s.claimDial("br_ffffffffffffffffffffffff", 1500)).toBeNull();
  });
});
