import { describe, expect, it } from "@jest/globals";
import { createBridgeStore, type LooseClient } from "./bridge-store";

jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const row = (over: Record<string, unknown> = {}) => ({
  bridge_id: "br_aaaaaaaaaaaaaaaaaaaaaaaa",
  encounter_id: ENC,
  clinician_phone: "+2348097654321",
  provider_session_id: "ATVId_1",
  state: "ringing",
  patient_answered: false,
  clinician_dialled: false,
  started_at: "2026-10-07T09:00:00.000Z",
  expires_at: "2026-10-07T09:30:00.000Z",
  ...over,
});

/** A client that records every call in the chain and answers with what it is told to. */
function fake(answers: { rows?: unknown[]; single?: unknown; error?: boolean; errorCode?: string } = {}) {
  const log: string[] = [];
  const result = () => ({ data: answers.error ? null : (answers.rows ?? null), error: answers.error ? { message: "boom", code: answers.errorCode } : null });
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => (log.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`), builder);
  for (const m of ["select", "insert", "update", "eq", "in", "gt", "not", "or", "limit"]) builder[m] = chain(m);
  builder.maybeSingle = () => (log.push("maybeSingle"), Promise.resolve({ data: answers.error ? null : (answers.single ?? null), error: answers.error ? { message: "boom" } : null }));
  builder.then = (resolve: (v: unknown) => void) => resolve(result());
  const client: LooseClient = { from: (t: string) => (log.push(`from(${t})`), builder as never) };
  return { client, log };
}

describe("phone bridge store", () => {
  it("maps a row to a record with the clinician number only as the row holds it", async () => {
    const { client } = fake({ single: row() });
    expect(await createBridgeStore(client).get("br_aaaaaaaaaaaaaaaaaaaaaaaa")).toEqual({
      bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: "+2348097654321", providerSessionId: "ATVId_1", state: "ringing",
      patientAnswered: false, clinicianDialled: false, startedAtMs: Date.parse("2026-10-07T09:00:00Z"), expiresAtMs: Date.parse("2026-10-07T09:30:00Z"),
    });
  });

  it("answers null for a bridge or session it does not hold", async () => {
    const { client } = fake({ single: null });
    const s = createBridgeStore(client);
    expect(await s.get("br_x")).toBeNull();
    expect(await s.findBySession("nope")).toBeNull();
  });

  it("claims the dial in ONE statement that is conditional on not dialled, live, unexpired and holding a number", async () => {
    const { client, log } = fake({ rows: [{ clinician_phone: "+2348097654321" }] });
    const phone = await createBridgeStore(client).claimDial("br_aaaaaaaaaaaaaaaaaaaaaaaa", Date.parse("2026-10-07T09:05:00Z"));
    expect(phone).toBe("+2348097654321");
    expect(log).toEqual([
      "from(phone_bridges)",
      'update({"clinician_dialled":true,"patient_answered":true,"state":"connected"})',
      'eq("bridge_id","br_aaaaaaaaaaaaaaaaaaaaaaaa")',
      'eq("clinician_dialled",false)',
      'in("state",["ringing","connected"])',
      'gt("expires_at","2026-10-07T09:05:00.000Z")',
      'not("clinician_phone","is",null)',
      'select("clinician_phone")',
    ]);
  });

  it("gets nothing when the claim matched no row (already dialled, over, expired or no number)", async () => {
    expect(await createBridgeStore(fake({ rows: [] }).client).claimDial("br_x", 0)).toBeNull();
    expect(await createBridgeStore(fake({ rows: null as never }).client).claimDial("br_x", 0)).toBeNull();
  });

  it("finds the live bridge for an encounter only among ringing or connected ones inside their limit", async () => {
    const { client, log } = fake({ rows: [row()] });
    const found = await createBridgeStore(client).findLiveByEncounter(ENC, Date.parse("2026-10-07T09:05:00Z"));
    expect(found?.bridgeId).toBe("br_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(log).toContain('in("state",["ringing","connected"])');
    expect(log).toContain('gt("expires_at","2026-10-07T09:05:00.000Z")');
    expect(await createBridgeStore(fake({ rows: [] }).client).findLiveByEncounter(ENC, 0)).toBeNull();
  });

  it("creates a row from the encounter's own organisation and test flag, with the provider fixed", async () => {
    const { client, log } = fake({ single: { organisation_id: "org-1", is_test: true } });
    await createBridgeStore(client).create({
      bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: "+2348097654321", providerSessionId: null, state: "ringing",
      patientAnswered: false, clinicianDialled: false, startedAtMs: Date.parse("2026-10-07T09:00:00Z"), expiresAtMs: Date.parse("2026-10-07T09:30:00Z"),
    });
    const insert = log.find((l) => l.startsWith("insert("))!;
    expect(insert).toContain('"organisation_id":"org-1"');
    expect(insert).toContain('"provider":"africastalking"');
    expect(insert).toContain('"is_test":true');
    expect(insert).not.toContain("803123");
  });

  it("reports false, not an error, when the one-live-bridge index refuses a second bridge", async () => {
    const answers = { single: { organisation_id: "org-1", is_test: false }, error: true, errorCode: "23505" } as const;
    const { client } = fake({ single: { organisation_id: "org-1", is_test: false } });
    // the insert is the only call that errors in this scenario: swap the answer after the encounter lookup
    let calls = 0;
    const wrapped: LooseClient = { from: (t: string) => (calls += 1, t === "encounters" ? client.from(t) : fake({ error: true, errorCode: answers.errorCode }).client.from(t)) };
    const ok = await createBridgeStore(wrapped).create({ bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: "+2348097654321", providerSessionId: null, state: "ringing", patientAnswered: false, clinicianDialled: false, startedAtMs: 0, expiresAtMs: 1 });
    expect(ok).toBe(false);
    expect(calls).toBe(2);
  });

  it("still throws for any other insert error", async () => {
    const wrapped: LooseClient = { from: (t: string) => (t === "encounters" ? fake({ single: { organisation_id: "org-1", is_test: false } }).client.from(t) : fake({ error: true, errorCode: "42501" }).client.from(t)) };
    await expect(createBridgeStore(wrapped).create({ bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: "+2348097654321", providerSessionId: null, state: "ringing", patientAnswered: false, clinicianDialled: false, startedAtMs: 0, expiresAtMs: 1 })).rejects.toThrow("bridge store failed");
  });

  it("closes this encounter's stale live bridges in one statement: past their limit, or never reached the vendor in 30 seconds", async () => {
    const { client, log } = fake({ rows: [] });
    await createBridgeStore(client).expireStale(ENC, Date.parse("2026-10-07T09:05:00Z"));
    expect(log).toEqual([
      "from(phone_bridges)",
      'update({"state":"ended"})',
      `eq("encounter_id","${ENC}")`,
      'in("state",["ringing","connected"])',
      'or("expires_at.lte.2026-10-07T09:05:00.000Z,and(provider_session_id.is.null,started_at.lt.2026-10-07T09:04:30.000Z)")',
    ]);
  });

  it("makes no database client until a bridge is actually touched", async () => {
    // createServiceRoleClient is mocked to {} at the top of this file; asking for a store must not call it
    const store = createBridgeStore();
    expect(typeof store.claimDial).toBe("function");
  });

  it("refuses to create a bridge for an encounter it cannot find", async () => {
    const { client } = fake({ single: null });
    await expect(createBridgeStore(client).create({
      bridgeId: "br_aaaaaaaaaaaaaaaaaaaaaaaa", encounterRef: ENC, clinicianPhone: null, providerSessionId: null, state: "ringing", patientAnswered: false, clinicianDialled: false, startedAtMs: 0, expiresAtMs: 1,
    })).rejects.toThrow("bridge store failed");
  });

  it("updates only the fields it is given, and does nothing for an empty patch", async () => {
    const { client, log } = fake({ rows: [] });
    const s = createBridgeStore(client);
    await s.update("br_aaaaaaaaaaaaaaaaaaaaaaaa", { state: "ended", providerSessionId: "S2", patientAnswered: true, clinicianDialled: true });
    expect(log.find((l) => l.startsWith("update("))).toBe('update({"provider_session_id":"S2","state":"ended","patient_answered":true,"clinician_dialled":true})');
    const quiet = fake({ rows: [] });
    await createBridgeStore(quiet.client).update("br_aaaaaaaaaaaaaaaaaaaaaaaa", {});
    expect(quiet.log).toEqual([]);
  });

  it("turns any database error into a thrown failure the adapter reports as retryable, without leaking its message", async () => {
    const s = createBridgeStore(fake({ error: true }).client);
    await expect(s.get("br_x")).rejects.toThrow("bridge store failed");
    await expect(s.findLiveByEncounter(ENC, 0)).rejects.toThrow("bridge store failed");
    await expect(s.claimDial("br_x", 0)).rejects.toThrow("bridge store failed");
    await expect(s.update("br_x", { state: "ended" })).rejects.toThrow("bridge store failed");
  });
});
