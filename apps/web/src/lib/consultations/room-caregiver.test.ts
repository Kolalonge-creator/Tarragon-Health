import { describe, expect, it } from "@jest/globals";
import { caregiverParticipantKey, createMockVideo, participantKey, passFromCaregiverKey, roleFromParticipantKey, type VideoProvider } from "@tarragon/integrations";
import { joinConsultation, prepareSdkJoin, requestDialIn, type RpcClient, type SdkJoinOptions } from "./room";

// CGJ: an invited caregiver's way into a consultation, against the real mock video provider and an in-memory stand-in for the database
// functions. The database side (who may be invited, expiry, removal, privileges) is proved in
// packages/db/tests/cgj_caregiver_in_consultation.sql; here we prove what the SERVER CODE does with the answers.

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const PATIENT = "11111111-1111-4111-8111-111111111111";
const DOCTOR = "22222222-2222-4222-8222-222222222222";
const CAREGIVER = "44444444-4444-4444-8444-444444444444";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const PASS = "55555555-5555-4555-8555-555555555555";
const SECRET = "server-only-secret";
const T0 = 1_800_000_000_000;

type Evt = { kind: string; payload: Record<string, unknown> };

function setup(o: { passState?: "accepted" | "invited" | "removed"; roomOpen?: boolean; guardOff?: boolean; joinable?: boolean; recordResult?: string; listFails?: boolean } = {}) {
  const video: VideoProvider = createMockVideo(() => T0);
  const s = { events: [] as Evt[], roomId: null as string | null, passLookups: 0, passFail: false };
  const ready = (async () => {
    if (o.roomOpen === false) return;
    const created = await video.createRoom({ encounterRef: ENC, expiresAtMs: T0 + 3_600_000 });
    if (created.ok) s.roomId = created.data.roomId;
  })();
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const bad = (message: string, code?: string) => Promise.resolve({ data: null, error: { message, ...(code ? { code } : {}) } });
  const service: RpcClient = {
    rpc: async (fn, args = {}) => {
      await ready;
      if (fn === "service_get_encounter_room") {
        return ok({
          encounter_id: ENC,
          patient_id: PATIENT,
          clinician_id: DOCTOR,
          status: "scheduled",
          final_media_mode: null,
          join_opens_at: new Date(T0 - 600_000).toISOString(),
          join_closes_at: new Date(T0 + 3_600_000).toISOString(),
          go_live_open: !o.guardOff,
          joinable: o.joinable ?? true,
          session_minutes: 30,
          room: { provider: "mock", provider_room_id: s.roomId, state: s.roomId ? "open" : "pending", expires_at: null },
        });
      }
      if (fn === "service_get_caregiver_pass") {
        s.passLookups += 1;
        if (s.passFail) return bad("boom");
        // the database answers a pass only for the accepted caregiver of THIS consultation
        return ok(args.p_encounter === ENC && args.p_user === CAREGIVER && (o.passState ?? "accepted") === "accepted" ? { pass_id: PASS } : null);
      }
      if (fn === "service_record_caregiver_event") {
        if (o.recordResult && o.recordResult !== "recorded") return ok(o.recordResult);
        s.events.push({ kind: String(args.p_kind), payload: { pass_id: args.p_pass, mode: args.p_mode } });
        return ok("recorded");
      }
      if (fn === "service_record_join") {
        s.events.push({ kind: "joined", payload: { role: args.p_role } });
        return ok(null);
      }
      if (fn === "service_open_encounter_room") return ok({ provider: "mock", provider_room_id: "x", state: "open", expires_at: null, created: true });
      return bad(`unknown ${fn}`);
    },
  };
  const user: RpcClient = { rpc: () => bad("not used") };
  const deps = (userId: string) => ({ userId, userRpc: user, serviceRpc: service, video, now: () => T0 });
  const options = (p: Partial<SdkJoinOptions> = {}): SdkJoinOptions => ({ participantKeySecret: SECRET, presenceFromWebhook: false, hostKeyTtlSeconds: 300, ...p });
  return { s, deps, options };
}

describe("an invited caregiver joins through the same SDK path", () => {
  it("gets a participant's credential: a key bound to the invite, the role word as the label, no host key, and the join recorded as their own", async () => {
    const { s, deps, options } = setup();
    const res = await prepareSdkJoin(deps(CAREGIVER), ENC, "audio_only", options());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.join.role).toBe("caregiver");
    expect(res.join.displayLabel).toBe("caregiver");
    expect(res.join.zak).toBeNull();
    expect(res.join.mediaMode).toBe("audio_only");
    expect(res.join.recordedAtIssue).toBe(true);
    expect(res.join.meetingNumber).toBe(s.roomId);
    expect(res.join.signature).toMatch(/^mocktoken\./);
    // the key proves the invite and nothing else: it is the caregiver key for this pass, not the patient's or the clinician's
    expect(res.join.customerKey).toBe(await caregiverParticipantKey(SECRET, ENC, PASS));
    expect(res.join.customerKey).not.toBe(await participantKey(SECRET, ENC, "patient"));
    expect(res.join.customerKey).not.toBe(await participantKey(SECRET, ENC, "clinician"));
    expect(await roleFromParticipantKey(SECRET, ENC, res.join.customerKey)).toBeNull();
    expect(await passFromCaregiverKey(SECRET, ENC, res.join.customerKey, [PASS])).toBe(PASS);
    // recorded as a caregiver event with the pass id, never as the patient's or the clinician's join
    expect(s.events).toEqual([{ kind: "caregiver_joined", payload: { pass_id: PASS, mode: "audio_only" } }]);
    expect(s.events.some((e) => e.kind === "joined")).toBe(false);
    // no name, no patient id in what the browser is handed
    expect(JSON.stringify(res.join)).not.toContain(PATIENT);
    expect(JSON.stringify(res.join)).not.toContain(CAREGIVER);
  });

  it("when presence comes from the vendor's webhook, the join waits for it instead of being recorded at issue", async () => {
    const { s, deps, options } = setup();
    const res = await prepareSdkJoin(deps(CAREGIVER), ENC, "video", options({ presenceFromWebhook: true }));
    expect(res.ok && res.join.recordedAtIssue).toBe(false);
    expect(s.events).toHaveLength(0);
  });

  it("answers a stranger, an invited-but-not-accepted caregiver and a removed one exactly like an unknown id, and records nothing", async () => {
    for (const passState of ["accepted", "invited", "removed"] as const) {
      const { s, deps, options } = setup({ passState });
      const who = passState === "accepted" ? STRANGER : CAREGIVER;
      expect(await prepareSdkJoin(deps(who), ENC, "video", options())).toEqual({ ok: false, reason: "not_found" });
      expect(s.events).toHaveLength(0);
    }
  });

  it("treats a failing credential check as no (it never lets anyone in)", async () => {
    const { s, deps, options } = setup();
    s.passFail = true;
    expect(await prepareSdkJoin(deps(CAREGIVER), ENC, "video", options())).toEqual({ ok: false, reason: "not_found" });
  });

  it("never opens the room itself: a caregiver waits for the care team to open it", async () => {
    const { s, deps, options } = setup({ roomOpen: false });
    expect(await prepareSdkJoin(deps(CAREGIVER), ENC, "video", options())).toEqual({ ok: false, reason: "not_ready" });
    expect(s.roomId).toBeNull();
    expect(s.events).toHaveLength(0);
  });

  it("fails closed when go-live is off, and outside the join window", async () => {
    const off = setup({ guardOff: true });
    expect(await prepareSdkJoin(off.deps(CAREGIVER), ENC, "video", off.options())).toEqual({ ok: false, reason: "not_live" });
    const early = setup({ joinable: false });
    const res = await prepareSdkJoin(early.deps(CAREGIVER), ENC, "video", early.options());
    expect(res).toMatchObject({ ok: false, reason: "not_open" });
    expect(early.s.events).toHaveLength(0);
  });

  it("does not hand out a credential the database refused to record (removed or ended a moment ago)", async () => {
    for (const recordResult of ["refused", "refused_removed"]) {
      const { s, deps, options } = setup({ recordResult });
      expect(await prepareSdkJoin(deps(CAREGIVER), ENC, "video", options())).toEqual({ ok: false, reason: "closed" });
      expect(s.events).toHaveLength(0);
    }
  });

  it("is not available at all when the in-app call is not configured (there is no link to fall back to)", async () => {
    const { deps, options } = setup();
    expect(await prepareSdkJoin(deps(CAREGIVER), ENC, "video", options({ participantKeySecret: null }))).toEqual({ ok: false, reason: "not_configured" });
  });

  it("is never given a link or the phone numbers: neither carries the key that ties a person to the invite", async () => {
    const { s, deps } = setup();
    expect(await joinConsultation(deps(CAREGIVER), ENC, "video")).toEqual({ ok: false, reason: "not_found" });
    expect(await requestDialIn(deps(CAREGIVER), ENC)).toEqual({ ok: false, reason: "not_allowed" });
    expect(s.events).toHaveLength(0);
  });

  it("leaves the patient's and the clinician's own paths as they were", async () => {
    const { s, deps, options } = setup();
    const pat = await prepareSdkJoin(deps(PATIENT), ENC, "video", options());
    expect(pat.ok && pat.join.role).toBe("patient");
    if (pat.ok) expect(pat.join.customerKey).toBe(await participantKey(SECRET, ENC, "patient"));
    expect(s.events.some((e) => e.kind === "caregiver_joined")).toBe(false);
  });
});
