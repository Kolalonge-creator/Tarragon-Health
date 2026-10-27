import { describe, expect, it } from "@jest/globals";
import { caregiverParticipantKey, createMockVideo } from "@tarragon/integrations";
import { handleVideoWebhook, type PresenceDeps } from "./presence";
import type { RpcClient } from "./room";

// CGJ: an invited caregiver's presence, verified by a key bound to ONE invite on THIS consultation.
const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const OTHER_ENC = "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97";
const SECRET = "server-only-participant-secret";
const PASS = "55555555-5555-4555-8555-555555555555";
const PASS_OTHER = "66666666-6666-4666-8666-666666666666";

type Reply = string | { error: { message: string; code?: string } };

function setup(result: Reply = "recorded", ids: unknown = [PASS], idsError = false) {
  const video = createMockVideo(() => 1);
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const serviceRpc: RpcClient = {
    rpc: (fn, args = {}) => {
      calls.push({ fn, args });
      if (fn === "service_caregiver_pass_ids") return Promise.resolve(idsError ? { data: null, error: { message: "down" } } : { data: ids, error: null });
      if (fn === "service_record_caregiver_event") return Promise.resolve(typeof result === "string" ? { data: result, error: null } : { data: null, error: result.error });
      return Promise.resolve({ data: null, error: null });
    },
  };
  const deps: PresenceDeps = {
    video,
    serviceRpc,
    encounterForRoom: async (roomId) => (roomId === "room_1" ? { encounterId: ENC } : null),
    participantKeySecret: SECRET,
    webhookSecretToken: "zoom-endpoint-secret",
    now: () => 1,
    log: (m) => logs.push(m),
  };
  const send = async (body: Parameters<typeof video.signedEvent>[0]) => {
    const { rawBody, headers } = await video.signedEvent(body);
    return handleVideoWebhook(deps, rawBody, headers);
  };
  return { send, calls, logs };
}

describe("presence of an invited caregiver", () => {
  it("records a join and a leave as the caregiver's own events, found from the key and never from the label", async () => {
    const { send, calls } = setup();
    const key = await caregiverParticipantKey(SECRET, ENC, PASS);
    expect(await send({ type: "participant_joined", roomId: "room_1", label: "clinician", customerKey: key })).toEqual({ status: 200, body: { handled: true, kind: "participant_joined", role: "caregiver" } });
    expect((await send({ type: "participant_left", roomId: "room_1", label: "caregiver", customerKey: key })).body).toMatchObject({ handled: true, kind: "participant_left" });
    expect(calls.filter((c) => c.fn === "service_record_caregiver_event").map((c) => c.args)).toEqual([
      { p_pass: PASS, p_kind: "caregiver_joined", p_mode: "unknown" },
      { p_pass: PASS, p_kind: "caregiver_left", p_mode: "unknown" },
    ]);
    // it never touches the patient's or the clinician's join, so it cannot start a call or move a no-show
    expect(calls.some((c) => c.fn === "service_record_join")).toBe(false);
  });

  it("ignores a caregiver key from another invite, another consultation, or a made-up one", async () => {
    const { send, calls, logs } = setup("recorded", [PASS]);
    for (const key of [await caregiverParticipantKey(SECRET, ENC, PASS_OTHER), await caregiverParticipantKey(SECRET, OTHER_ENC, PASS), "g" + "0".repeat(34)]) {
      expect((await send({ type: "participant_joined", roomId: "room_1", label: "caregiver", customerKey: key })).body).toEqual({ handled: false, reason: "key_mismatch" });
    }
    expect(calls.some((c) => c.fn === "service_record_caregiver_event")).toBe(false);
    // the log names the encounter and the code, never a key
    expect(logs).toHaveLength(3);
    expect(logs.join(" ")).not.toMatch(/g0000/);
  });

  it("acknowledges and logs a re-entry by a removed caregiver without recording a join", async () => {
    const { send, logs } = setup("refused_removed");
    const r = await send({ type: "participant_joined", roomId: "room_1", label: "caregiver", customerKey: await caregiverParticipantKey(SECRET, ENC, PASS) });
    expect(r).toEqual({ status: 200, body: { handled: false, reason: "refused" } });
    expect(logs.some((l) => l.includes("refused_removed") && l.includes(ENC))).toBe(true);
  });

  it("asks the vendor to retry when the database could not be reached, but not when it refused for good", async () => {
    const key = await caregiverParticipantKey(SECRET, ENC, PASS);
    const down = setup({ error: { message: "down" } });
    expect((await down.send({ type: "participant_joined", roomId: "room_1", label: "caregiver", customerKey: key })).status).toBe(500);
    const final = setup({ error: { message: "no", code: "P0001" } });
    expect((await final.send({ type: "participant_joined", roomId: "room_1", label: "caregiver", customerKey: key })).body).toEqual({ handled: false, reason: "refused" });
    const noList = setup("recorded", null);
    expect((await noList.send({ type: "participant_joined", roomId: "room_1", label: "caregiver", customerKey: key })).body).toEqual({ handled: false, reason: "key_mismatch" });
  });

  it("asks the vendor to retry when the list of invites cannot be read", async () => {
    const { send } = setup("recorded", [PASS], true);
    expect(await send({ type: "participant_joined", roomId: "room_1", label: "caregiver", customerKey: await caregiverParticipantKey(SECRET, ENC, PASS) })).toEqual({ status: 500, body: { error: "lookup_failed" } });
  });
});
