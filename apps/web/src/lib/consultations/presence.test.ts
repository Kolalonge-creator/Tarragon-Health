import { describe, expect, it, jest } from "@jest/globals";
import { createMockVideo, hmacHex, participantKey } from "@tarragon/integrations";
import { handleVideoWebhook, type PresenceDeps } from "./presence";
import type { RpcClient } from "./room";

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const OTHER_ENC = "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97";
const SECRET = "server-only-participant-secret";
const HOOK = "zoom-endpoint-secret";

function setup(over: Partial<PresenceDeps> = {}) {
  const video = createMockVideo(() => 1);
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  let rpcError: { message: string; code?: string } | null = null;
  const serviceRpc: RpcClient = {
    rpc: (fn, args = {}) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: null, error: rpcError });
    },
  };
  const deps: PresenceDeps = {
    video,
    serviceRpc,
    encounterForRoom: async (roomId) => (roomId === "room_1" ? { encounterId: ENC } : null),
    participantKeySecret: SECRET,
    webhookSecretToken: HOOK,
    now: () => 1,
    log: (m) => logs.push(m),
    ...over,
  };
  const send = async (body: Parameters<typeof video.signedEvent>[0]) => {
    const { rawBody, headers } = await video.signedEvent(body);
    return handleVideoWebhook(deps, rawBody, headers);
  };
  return { deps, send, calls, logs, failWith: (e: { message: string; code?: string }) => (rpcError = e), video };
}

describe("presence from the vendor's webhook", () => {
  it("records a join for the role the key was issued for, whatever display name the person chose", async () => {
    const { send, calls } = setup();
    const key = await participantKey(SECRET, ENC, "clinician");
    // the person typed their own name; it plays no part
    expect(await send({ type: "participant_joined", roomId: "room_1", label: "Ada Obi", customerKey: key })).toEqual({ status: 200, body: { handled: true, kind: "participant_joined", role: "clinician" } });
    expect(calls).toEqual([{ fn: "service_record_join", args: { p_encounter: ENC, p_role: "clinician", p_mode: "unknown" } }]);
  });

  it("refuses a patient who calls themselves the clinician: their own key says patient, so that is all that is recorded", async () => {
    const { send, calls } = setup();
    const patientKey = await participantKey(SECRET, ENC, "patient");
    const r = await send({ type: "participant_joined", roomId: "room_1", label: "clinician", customerKey: patientKey });
    expect(r.body).toMatchObject({ handled: true, role: "patient" });
    expect(calls[0]?.args["p_role"]).toBe("patient");
  });

  it("ignores a forged or borrowed key: a made-up key, a key from another consultation, and a label alone record nothing", async () => {
    const { send, calls, logs } = setup();
    expect((await send({ type: "participant_joined", roomId: "room_1", label: "clinician", customerKey: "cdeadbeefdeadbeefdeadbeefdeadbeef00" })).body).toEqual({ handled: false, reason: "key_mismatch" });
    expect((await send({ type: "participant_joined", roomId: "room_1", label: "clinician", customerKey: await participantKey(SECRET, OTHER_ENC, "clinician") })).body).toEqual({ handled: false, reason: "key_mismatch" });
    expect((await send({ type: "participant_joined", roomId: "room_1", label: "clinician" })).body).toEqual({ handled: false, reason: "no_key" });
    expect(calls).toHaveLength(0);
    // the log names the encounter and nothing else: no key, label or body (a key-less event is logged too, so a vendor that never sends
    // the key back shows up in the logs instead of presence silently doing nothing)
    expect(logs).toHaveLength(3);
    expect(logs[2]).toContain("without a participant key");
    expect(logs.join(" ")).not.toMatch(/deadbeef|clinician|Ada/);
  });

  it("records a leave as the verified role", async () => {
    const { send, calls } = setup();
    const r = await send({ type: "participant_left", roomId: "room_1", label: "patient", customerKey: await participantKey(SECRET, ENC, "patient") });
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ fn: "service_record_encounter_event", args: { p_encounter: ENC, p_kind: "left", p_actor_role: "patient", p_payload: {} } }]);
  });

  it("acknowledges rooms that are not consultations (the older visit flow shares the account) and events it does not act on", async () => {
    const { send, calls } = setup();
    const key = await participantKey(SECRET, ENC, "patient");
    expect((await send({ type: "participant_joined", roomId: "room_visit", label: "patient", customerKey: key })).body).toEqual({ handled: false, reason: "unknown_room" });
    expect((await send({ type: "room_ended", roomId: "room_1" })).body).toEqual({ handled: false });
    expect((await send({ type: "other", roomId: "room_1" })).body).toEqual({ handled: false });
    expect(calls).toHaveLength(0);
  });

  it("rejects an unsigned or forged request, and says so when it has no secrets to check with", async () => {
    const { deps } = setup();
    expect(await handleVideoWebhook(deps, "{}", {})).toMatchObject({ status: 401 });
    expect(await handleVideoWebhook(deps, "{}", { "x-mock-signature": "00" })).toMatchObject({ status: 401 });
    const body = await setup().video.signedEvent({ type: "participant_joined", roomId: "room_1", label: "x", customerKey: "k" });
    // a signed event with no way to verify the key is a server problem, never a silent success
    expect(await handleVideoWebhook({ ...deps, participantKeySecret: null }, body.rawBody, body.headers)).toEqual({ status: 503, body: { error: "not_configured" } });
    const notJson = await handleVideoWebhook(deps, "nope", { "x-mock-signature": await hmacHex("SHA-256", "mock-video-webhook-secret", "nope") });
    expect(notJson).toMatchObject({ status: 400 });
  });

  it("acknowledges a correctly signed event that arrived outside the replay window (200, logged), instead of a 401 the vendor counts as failing", async () => {
    const { deps, video, logs, calls } = setup();
    jest.spyOn(video, "parseWebhook").mockResolvedValueOnce({ ok: false, error: { code: "stale_event", message: "x", retryable: false } });
    expect(await handleVideoWebhook(deps, "{}", {})).toEqual({ status: 200, body: { handled: false, reason: "stale" } });
    expect(logs).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("maps a vendor that cannot check signatures to 503 so it is retried", async () => {
    const { deps, video } = setup();
    jest.spyOn(video, "parseWebhook").mockResolvedValueOnce({ ok: false, error: { code: "not_configured", message: "x", retryable: false } });
    expect(await handleVideoWebhook(deps, "{}", {})).toEqual({ status: 503, body: { error: "not_configured" } });
  });

  describe("a failure to save", () => {
    it("is retried (500) when it could be transient, so presence is not lost", async () => {
      const { send, failWith, logs } = setup();
      failWith({ message: "connection reset", code: "08006" });
      const r = await send({ type: "participant_joined", roomId: "room_1", label: "x", customerKey: await participantKey(SECRET, ENC, "patient") });
      expect(r).toEqual({ status: 500, body: { error: "record_failed" } });
      expect(logs[0]).toContain("not saved");
    });
    it("is also retried when the error has no code at all", async () => {
      const { send, failWith } = setup();
      failWith({ message: "boom" });
      expect((await send({ type: "participant_joined", roomId: "room_1", label: "x", customerKey: await participantKey(SECRET, ENC, "patient") })).status).toBe(500);
    });
    it("is acknowledged (200) when the database will always refuse it, such as outside the join window", async () => {
      const { send, failWith, logs } = setup();
      failWith({ message: "outside the join window", code: "P0001" });
      const r = await send({ type: "participant_joined", roomId: "room_1", label: "x", customerKey: await participantKey(SECRET, ENC, "patient") });
      expect(r).toEqual({ status: 200, body: { handled: false, reason: "refused" } });
      expect(logs[0]).toContain("refused");
    });
    it("is retried when the room lookup itself fails", async () => {
      const { send, logs } = setup({ encounterForRoom: async () => "error" });
      const r = await send({ type: "participant_joined", roomId: "room_1", label: "x", customerKey: "k" });
      expect(r).toEqual({ status: 500, body: { error: "lookup_failed" } });
      expect(logs).toHaveLength(1);
    });
  });

  describe("the one-time URL handshake", () => {
    const challenge = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "abc12345xyz" } });
    it("answers with the challenge and its HMAC under our secret", async () => {
      const { deps } = setup();
      const r = await handleVideoWebhook(deps, challenge, {});
      expect(r).toEqual({ status: 200, body: { plainToken: "abc12345xyz", encryptedToken: await hmacHex("SHA-256", HOOK, "abc12345xyz") } });
    });
    it("is not an oracle for forging a signature: a challenge shaped like a signed message (v0:timestamp:body) is refused", async () => {
      const { deps } = setup();
      const forged = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: 'v0:1800000000:{"event":"meeting.participant_joined"}' } });
      const r = await handleVideoWebhook(deps, forged, {});
      expect(r.status).toBe(401);
      expect(r.body).not.toHaveProperty("encryptedToken");
      for (const token of ["has space token", "a".repeat(257), "colon:inside", "", "tab\there"]) {
        const body = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: token } });
        expect((await handleVideoWebhook(deps, body, {})).body).not.toHaveProperty("encryptedToken");
      }
    });
    it("cannot answer without the secret, and does not mistake other bodies for a challenge", async () => {
      const { deps } = setup({ webhookSecretToken: null });
      expect(await handleVideoWebhook(deps, challenge, {})).toEqual({ status: 503, body: { error: "not_configured" } });
      for (const body of ['{"event":"endpoint.url_validation"}', '{"event":"endpoint.url_validation","payload":{"plainToken":""}}', '{"event":"other","payload":{"plainToken":"x"}}', "[]", "null", "{}"]) {
        // none of these is a challenge, so each goes to signature checking and fails it
        expect((await handleVideoWebhook(deps, body, {})).status).toBe(401);
      }
    });
  });
});
