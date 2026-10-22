import { describe, expect, it } from "@jest/globals";
import {
  asVideoRole,
  caregiverParticipantKey,
  createMockVideo,
  isSafeWebhookChallenge,
  isSampleDue,
  ladderInputFromConnection,
  participantKey,
  passFromCaregiverKey,
  qualityFromAudioStats,
  qualityFromNetworkLevel,
  roleFromParticipantKey,
  worstQuality,
  type AudioStatsPolicy,
} from "../../../supabase/functions/_shared/integrations/index.ts";
import { getProposedConfig } from "../../shared/src/proposed-config/index";

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const OTHER = "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97";
const SECRET = "server-only-secret";

describe("participant keys (who actually entered the call)", () => {
  it("is an opaque key within the vendor's 36 character limit, with no name or id in it", async () => {
    const key = await participantKey(SECRET, ENC, "patient");
    expect(key).toMatch(/^p[0-9a-f]{34}$/);
    expect(key.length).toBeLessThanOrEqual(36);
    expect(key).not.toContain(ENC.slice(0, 8));
    expect(await participantKey(SECRET, ENC, "clinician")).toMatch(/^c[0-9a-f]{34}$/);
  });

  it("is stable, so a rejoin presents the same key", async () => {
    expect(await participantKey(SECRET, ENC, "patient")).toBe(await participantKey(SECRET, ENC, "patient"));
  });

  it("verifies to the role it was issued for, on that encounter only", async () => {
    const patient = await participantKey(SECRET, ENC, "patient");
    const clinician = await participantKey(SECRET, ENC, "clinician");
    expect(await roleFromParticipantKey(SECRET, ENC, patient)).toBe("patient");
    expect(await roleFromParticipantKey(SECRET, ENC, clinician)).toBe("clinician");
    // a key from another consultation proves nothing here
    expect(await roleFromParticipantKey(SECRET, OTHER, clinician)).toBeNull();
  });

  it("refuses a patient who passes themselves off as the clinician: the label, a guessed key or a swapped letter all fail", async () => {
    const patient = await participantKey(SECRET, ENC, "patient");
    expect(await roleFromParticipantKey(SECRET, ENC, "clinician")).toBeNull();
    expect(await roleFromParticipantKey(SECRET, ENC, `c${patient.slice(1)}`)).toBeNull();
    expect(await roleFromParticipantKey(SECRET, ENC, "")).toBeNull();
    expect(await roleFromParticipantKey("another-secret", ENC, patient)).toBeNull();
  });
});

describe("caregiver participant keys (CGJ: who entered a call as an invited caregiver)", () => {
  const PASS_A = "a1111111-1111-4111-8111-111111111111";
  const PASS_B = "b2222222-2222-4222-8222-222222222222";

  it("is an opaque key within the vendor limit that cannot be mistaken for a patient or clinician key", async () => {
    const key = await caregiverParticipantKey(SECRET, ENC, PASS_A);
    expect(key).toMatch(/^g[0-9a-f]{34}$/);
    expect(key.length).toBeLessThanOrEqual(36);
    expect(key).not.toContain(PASS_A.slice(0, 8));
    expect(await roleFromParticipantKey(SECRET, ENC, key)).toBeNull();
  });

  it("verifies to its own pass on its own call only, and stays the same on a rejoin", async () => {
    const a = await caregiverParticipantKey(SECRET, ENC, PASS_A);
    expect(a).toBe(await caregiverParticipantKey(SECRET, ENC, PASS_A));
    expect(await passFromCaregiverKey(SECRET, ENC, a, [PASS_A, PASS_B])).toBe(PASS_A);
    expect(await passFromCaregiverKey(SECRET, ENC, await caregiverParticipantKey(SECRET, ENC, PASS_B), [PASS_A, PASS_B])).toBe(PASS_B);
    // another call, another secret, a pass that is not on this call, an empty list and a guessed key all prove nothing
    expect(await passFromCaregiverKey(SECRET, OTHER, a, [PASS_A, PASS_B])).toBeNull();
    expect(await passFromCaregiverKey("another-secret", ENC, a, [PASS_A])).toBeNull();
    expect(await passFromCaregiverKey(SECRET, ENC, a, [PASS_B])).toBeNull();
    expect(await passFromCaregiverKey(SECRET, ENC, a, [])).toBeNull();
    expect(await passFromCaregiverKey(SECRET, ENC, "g" + "0".repeat(34), [PASS_A])).toBeNull();
  });

  it("a patient key never verifies as a caregiver, and the display label is the role word", async () => {
    expect(await passFromCaregiverKey(SECRET, ENC, await participantKey(SECRET, ENC, "patient"), [PASS_A])).toBeNull();
    expect(asVideoRole("caregiver")).toBe("caregiver");
    expect(asVideoRole("Ada Okafor")).toBeNull();
  });
});

describe("SDK signals to ladder inputs", () => {
  it("maps connection states: a drop is lost, a return is restored, closing is the call ending, anything else is nothing", () => {
    expect(ladderInputFromConnection("Reconnecting", 5)).toEqual({ kind: "lost", atMs: 5 });
    expect(ladderInputFromConnection("Connected", 6)).toEqual({ kind: "restored", atMs: 6 });
    expect(ladderInputFromConnection("Closed", 7)).toBe("closed");
    expect(ladderInputFromConnection("Fail", 8)).toBe("failed");
    expect(ladderInputFromConnection("Connecting", 8)).toBeNull();
    expect(ladderInputFromConnection(undefined, 8)).toBeNull();
  });

  it("reads the vendor's own 0 to 5 network scale: 0 and 1 poor, 2 fair, 3 to 5 good, anything else no reading", () => {
    expect([0, 1, 2, 3, 4, 5].map(qualityFromNetworkLevel)).toEqual(["poor", "poor", "fair", "good", "good", "good"]);
    for (const bad of [-1, 6, 2.5, "3", null, undefined, Number.NaN]) expect(qualityFromNetworkLevel(bad)).toBeNull();
  });

  describe("audio statistics", () => {
    const base = getProposedConfig<{ poorAudioLossPercent: number; poorAudioRttMs: number }>("video.audio_fallback").value;
    const policy: AudioStatsPolicy = { poorAudioLossPercent: base.poorAudioLossPercent, poorAudioRttMs: base.poorAudioRttMs };
    it("takes its thresholds from the versioned config, not from the code", () => {
      expect(policy.poorAudioLossPercent).toBeGreaterThan(0);
      expect(policy.poorAudioRttMs).toBeGreaterThan(0);
    });
    it("is poor when loss or round trip time reaches its threshold, good below both", () => {
      expect(qualityFromAudioStats({ avg_loss: policy.poorAudioLossPercent, rtt: 1 }, policy)).toBe("poor");
      expect(qualityFromAudioStats({ avg_loss: 0, rtt: policy.poorAudioRttMs }, policy)).toBe("poor");
      expect(qualityFromAudioStats({ avg_loss: 0, rtt: 1 }, policy)).toBe("good");
    });
    it("uses whichever number is present, and is no reading when neither is usable", () => {
      expect(qualityFromAudioStats({ avg_loss: 0 }, policy)).toBe("good");
      expect(qualityFromAudioStats({ rtt: policy.poorAudioRttMs + 1 }, policy)).toBe("poor");
      for (const bad of [{}, { avg_loss: "x", rtt: Number.NaN }, null, undefined, 4, "no"]) expect(qualityFromAudioStats(bad, policy)).toBeNull();
    });
  });

  it("the worse reading wins, so one good direction cannot hide a bad one", () => {
    expect(worstQuality("good", "poor")).toBe("poor");
    expect(worstQuality("poor", "good")).toBe("poor");
    expect(worstQuality("fair", "fair")).toBe("fair");
    expect(worstQuality("poor", "lost")).toBe("lost");
  });

  it("thins statistics to one sample per interval", () => {
    expect(isSampleDue(null, 1000, 3)).toBe(true);
    expect(isSampleDue(1000, 3999, 3)).toBe(false);
    expect(isSampleDue(1000, 4000, 3)).toBe(true);
  });
});

describe("webhook URL challenge (the answer is an HMAC under the secret that signs events)", () => {
  it("accepts a plain token and refuses anything that could be a signed message", () => {
    for (const ok of ["qgg8vlvZRS6UYooatFL8Aw", "a", "tok-en_9=="]) expect(isSafeWebhookChallenge(ok)).toBe(true);
    for (const bad of ['v0:1800000000:{"event":"meeting.ended"}', "has space", "tab\there", "", "a".repeat(257), 5, null, undefined, {}]) expect(isSafeWebhookChallenge(bad)).toBe(false);
  });
});

describe("mock provider webhook carries the customer key like the vendor's", () => {
  it("keeps a key with an unknown label as a hint, and still ignores an unkeyed unknown label", async () => {
    const mock = createMockVideo(() => 1);
    const keyed = await mock.signedEvent({ type: "participant_joined", roomId: "room_1", label: "Ada", customerKey: "pabc" });
    expect(await mock.parseWebhook(keyed.rawBody, keyed.headers, 9)).toEqual({ ok: true, data: { kind: "participant_joined", roomId: "room_1", role: "observer", atMs: 9, customerKey: "pabc" } });
    const unkeyed = await mock.signedEvent({ type: "participant_joined", roomId: "room_1", label: "Ada" });
    expect(await mock.parseWebhook(unkeyed.rawBody, unkeyed.headers, 9)).toEqual({ ok: true, data: null });
  });

  it("hands a mock clinician the same host-key shape the real adapter does, and a patient none", async () => {
    const mock = createMockVideo(() => 1);
    const room = await mock.createRoom({ encounterRef: ENC, expiresAtMs: 600_000 });
    if (!room.ok) throw new Error("room");
    const doc = await mock.joinToken({ roomId: room.data.roomId, role: "clinician", identity: OTHER, ttlSeconds: 60 });
    const pat = await mock.joinToken({ roomId: room.data.roomId, role: "patient", identity: OTHER, ttlSeconds: 60 });
    expect(doc).toMatchObject({ ok: true, data: { zak: "mockzak", password: "mockpass" } });
    expect(pat.ok && pat.data.zak).toBeUndefined();
  });
});
