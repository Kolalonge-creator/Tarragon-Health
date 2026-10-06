import { describe, expect, it } from "@jest/globals";
import {
  createMockVideo,
  INITIAL_AUDIO_FALLBACK,
  isPoorSample,
  stepAudioFallback,
  type AudioFallbackPolicy,
  type AudioFallbackState,
  type QualitySample,
} from "../../../supabase/functions/_shared/integrations/index.ts";
import { getProposedConfig } from "../../shared/src/proposed-config/index";
import { runVideoContract } from "./contracts/video.contract";

let clock = 1_800_000_000_000;
runVideoContract(
  "mock",
  () => {
    const mock = createMockVideo(() => clock);
    const sign = (type: "participant_joined" | "participant_left" | "room_ended" | "other") => (roomId: string, label?: string) => mock.signedEvent({ type, roomId, label });
    return {
      provider: mock,
      advanceMs: (ms) => (clock += ms),
      emit: (e) => mock.emit(e),
      failNextCall: () => mock.failNextCall(),
      webhook: {
        roomEnded: (id) => sign("room_ended")(id),
        joined: (id, label) => sign("participant_joined")(id, label),
        left: (id, label) => sign("participant_left")(id, label),
        other: (id) => sign("other")(id),
        forged: async (id) => ({ rawBody: (await sign("room_ended")(id)).rawBody, headers: { "x-mock-signature": "00".repeat(32) } }),
      },
    };
  },
  () => clock,
);

const policy = getProposedConfig<AudioFallbackPolicy>("video.audio_fallback").value;
const poor: QualitySample = { quality: "poor" };
const good: QualitySample = { quality: "good", bitrateKbps: 900 };

const run = (samples: QualitySample[], from: AudioFallbackState = INITIAL_AUDIO_FALLBACK) => {
  const changes: (string | null)[] = [];
  let state = from;
  for (const s of samples) {
    const r = stepAudioFallback(state, s, policy);
    state = r.state;
    changes.push(r.change);
  }
  return { state, changes };
};

describe("audio-only fallback", () => {
  it("reads its thresholds from the versioned proposed config, not from code", () => {
    expect(policy.poorSamplesToDowngrade).toBeGreaterThan(1);
    expect(getProposedConfig("video.audio_fallback").status).toBe("proposed");
  });

  it("classifies lost and poor as poor, and a very low bitrate as poor even when the vendor says good", () => {
    expect(isPoorSample({ quality: "lost" }, policy)).toBe(true);
    expect(isPoorSample({ quality: "poor" }, policy)).toBe(true);
    expect(isPoorSample({ quality: "good", bitrateKbps: policy.poorBelowKbps - 1 }, policy)).toBe(true);
    expect(isPoorSample({ quality: "fair", bitrateKbps: policy.poorBelowKbps }, policy)).toBe(false);
    expect(isPoorSample({ quality: "fair" }, policy)).toBe(false);
  });

  it("one bad sample never downgrades, and a good sample resets the run", () => {
    const n = policy.poorSamplesToDowngrade;
    const { state, changes } = run([...Array(n - 1).fill(poor), good, ...Array(n - 1).fill(poor)]);
    expect(changes.every((c) => c === null)).toBe(true);
    expect(state.mode).toBe("video");
  });

  it("a sustained poor run drops to audio only, exactly once", () => {
    const n = policy.poorSamplesToDowngrade;
    const { state, changes } = run(Array(n + 3).fill(poor));
    expect(changes.filter((c) => c === "to_audio_only")).toHaveLength(1);
    expect(changes[n - 1]).toBe("to_audio_only");
    expect(state.mode).toBe("audio_only");
  });

  it("offers video again after a sustained good run, but never switches back by itself", () => {
    const n = policy.poorSamplesToDowngrade;
    const m = policy.goodSamplesToOfferVideo;
    const { state, changes } = run([...Array(n).fill(poor), ...Array(m + 5).fill(good)]);
    expect(changes.filter((c) => c === "offer_video")).toHaveLength(1);
    expect(state.mode).toBe("audio_only");
    expect(state.videoOffered).toBe(true);
  });

  it("withdraws an unaccepted offer when quality drops again", () => {
    const n = policy.poorSamplesToDowngrade;
    const m = policy.goodSamplesToOfferVideo;
    const { state } = run([...Array(n).fill(poor), ...Array(m).fill(good), poor]);
    expect(state.videoOffered).toBe(false);
  });
});

// ---- Zoom adapter over a fake Zoom ----
import { createZoomVideo } from "../../../supabase/functions/_shared/integrations/index.ts";
import { createFakeZoom, type FakeZoom } from "./support/fake-zoom";

const zoomFor = (fake: FakeZoom, extra: { webhookSecretToken?: string } = { webhookSecretToken: fake.webhookSecret }) =>
  createZoomVideo({
    accountId: "acc",
    clientId: "cid",
    clientSecret: "csecret",
    sdkKey: "sdk_key",
    sdkSecret: "sdk_secret_value",
    fetch: fake.fetch,
    now: () => fake.clock.now,
    ...extra,
  });

const zoomClock = { now: 1_800_000_000_000 };
runVideoContract(
  "zoom adapter over a fake vendor",
  () => {
    const fake = createFakeZoom(zoomClock);
    const provider = zoomFor(fake);
    return {
      provider,
      advanceMs: (ms) => (zoomClock.now += ms),
      failNextCall: () => fake.failNextCall(),
      webhook: {
        roomEnded: (id) => fake.signedEvent("meeting.ended", id),
        joined: (id, label) => fake.signedEvent("meeting.participant_joined", id, label),
        left: (id, label) => fake.signedEvent("meeting.participant_left", id, label),
        other: (id) => fake.signedEvent("meeting.started", id),
        forged: (id) => fake.forgedEvent("meeting.ended", id),
      },
    };
  },
  () => zoomClock.now,
);

/** A Zoom whose meeting lookup answers with the given body, for replies the fake never produces. */
const zoomWith = (meetingBody: string) =>
  createZoomVideo({
    accountId: "a", clientId: "c", clientSecret: "s", sdkKey: "k", sdkSecret: "s", now: () => Date.parse("2027-01-15T08:10:00Z"),
    fetch: async (u) => ({ status: 200, ok: true, text: async () => (u.includes("oauth") ? '{"access_token":"t","expires_in":3600}' : meetingBody) }),
  });

describe("zoom adapter", () => {
  const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
  const ID = "2f4b8c1d-9e07-4a63-b5d2-6c8e0a1f3d97";
  const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;

  it("without Meeting SDK keys it still creates rooms and join links, and only refuses an SDK token", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = createZoomVideo({ accountId: "acc", clientId: "cid", clientSecret: "csecret", fetch: fake.fetch, now: () => fake.clock.now });
    const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 30 * 60_000 });
    if (!room.ok) throw new Error("room");
    expect((await z.joinLink({ roomId: room.data.roomId, role: "patient", mediaMode: "video" })).ok).toBe(true);
    expect(await z.joinToken({ roomId: room.data.roomId, role: "patient", identity: ID, ttlSeconds: 60 })).toMatchObject({ ok: false, error: { code: "not_configured" } });
  });

  it("refuses an encounter reference or identity that only looks like a uuid", async () => {
    const z = zoomFor(createFakeZoom());
    const dashes = "-".repeat(36);
    expect(await z.createRoom({ encounterRef: dashes, expiresAtMs: 1_800_000_060_000 })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await z.joinToken({ roomId: "123456789", role: "patient", identity: dashes, ttlSeconds: 60 })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("creates a scheduled meeting with a neutral topic, the waiting room on and join-before-host off", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 45 * 60_000 });
    const call = fake.calls.find((c) => c.path === "/v2/users/me/meetings")!;
    expect(call.body).toMatchObject({ topic: "Tarragon consultation", type: 2, duration: 45, timezone: "Africa/Lagos", settings: { join_before_host: false, waiting_room: true } });
    expect(JSON.stringify(call.body)).not.toContain(ENC);
  });

  it("signs a Meeting SDK token: host for a clinician, attendee for everyone else, never outliving the meeting", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 30 * 60_000 });
    if (!room.ok) throw new Error("room");
    const doc = await z.joinToken({ roomId: room.data.roomId, role: "clinician", identity: ID, ttlSeconds: 3600 });
    const pat = await z.joinToken({ roomId: room.data.roomId, role: "patient", identity: ID, ttlSeconds: 600 });
    if (!doc.ok || !pat.ok) throw new Error("token");
    expect(decode(doc.data.token)).toMatchObject({ sdkKey: "sdk_key", mn: room.data.roomId, role: 1, exp: Math.floor(room.data.expiresAtMs / 1000) });
    expect(decode(pat.data.token)).toMatchObject({ role: 0, exp: Math.floor((fake.clock.now + 600_000) / 1000) });
    expect(JSON.stringify(decode(doc.data.token))).not.toContain(ID);
    expect(doc.data.token).not.toContain("sdk_secret_value");
  });

  it("turns automatic recording off when it creates the meeting", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 30 * 60_000 });
    const call = fake.calls.find((c) => c.path === "/v2/users/me/meetings")!;
    expect(call.body).toMatchObject({ settings: { auto_recording: "none" } });
  });

  it("gives only a clinician the host link, fetched from Zoom each time and never a stored one", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 30 * 60_000 });
    if (!room.ok) throw new Error("room");
    const pat = await z.joinLink({ roomId: room.data.roomId, role: "patient", mediaMode: "audio_only" });
    const doc = await z.joinLink({ roomId: room.data.roomId, role: "clinician", mediaMode: "video" });
    expect(pat.ok && pat.data.url).toContain("pwd=guest");
    expect(pat.ok && pat.data.url).not.toContain("zak=");
    expect(doc.ok && doc.data.url).toContain("zak=hostkey");
    expect(pat.ok && pat.data.audioOnlyEnforced).toBe(false);
    expect(fake.calls.filter((c) => c.method === "GET" && c.path === `/v2/meetings/${room.data.roomId}`)).toHaveLength(2);
  });

  it("refuses a join link for a malformed room id, an expired meeting, or a reply without a usable link", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    expect(await z.joinLink({ roomId: "abc", role: "patient", mediaMode: "video" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 60_000 });
    if (!room.ok) throw new Error("room");
    fake.clock.now += 3_600_000;
    expect(await z.joinLink({ roomId: room.data.roomId, role: "patient", mediaMode: "video" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    const reply = (body: string) => zoomWith(body);
    expect(await reply('{"start_time":"2027-01-15T08:00:00Z","duration":30}').joinLink({ roomId: "123456789", role: "patient", mediaMode: "video" })).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect(await reply('{"start_time":"2027-01-15T08:00:00Z","duration":30,"join_url":"http://insecure.example/j/1"}').joinLink({ roomId: "123456789", role: "patient", mediaMode: "video" })).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect(await reply("{}").joinLink({ roomId: "123456789", role: "patient", mediaMode: "video" })).toMatchObject({ ok: false, error: { code: "bad_response" } });
  });

  it("asks Zoom for audio by computer or phone with Nigerian numbers, and returns only Nigerian numbers with the phone passcode", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 30 * 60_000 });
    if (!room.ok) throw new Error("room");
    const created = fake.calls.find((c) => c.method === "POST" && c.path === "/v2/users/me/meetings");
    expect(created?.body?.["settings"]).toMatchObject({ audio: "both", global_dial_in_countries: ["NG"] });
    const d = await z.dialIn({ roomId: room.data.roomId, country: "NG" });
    expect(d).toMatchObject({ ok: true, data: { meetingId: room.data.roomId, passcode: "482913", numbers: [{ country: "NG", city: "Lagos", kind: "toll" }] } });
    expect(d.ok && d.data.numbers).toHaveLength(1);
    expect(d.ok && JSON.stringify(d.data)).not.toContain("zak=");
  });

  it("dial-in: no number for the country is not_found; a bad room, country or expired meeting is refused; an unusable passcode becomes none", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    expect(await z.dialIn({ roomId: "abc", country: "NG" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await z.dialIn({ roomId: "123456789", country: "ng" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 60_000 });
    if (!room.ok) throw new Error("room");
    expect(await z.dialIn({ roomId: room.data.roomId, country: "GH" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    fake.clock.now += 3_600_000;
    expect(await z.dialIn({ roomId: room.data.roomId, country: "NG" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    const reply = (body: string) => zoomWith(body);
    const base = '"start_time":"2027-01-15T08:00:00Z","duration":30';
    expect(await reply(`{${base}}`).dialIn({ roomId: "123456789", country: "NG" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await reply("{}").dialIn({ roomId: "123456789", country: "NG" })).toMatchObject({ ok: false, error: { code: "bad_response" } });
    const noPass = `{${base},"pstn_password":"abc","settings":{"global_dial_in_numbers":[{"country":"NG","number":"+234 1 888 0000","type":"tollfree"},{"country":"NG","number":"","type":"toll"},{"country":"NG","number":"+234 9","type":"weird"}]}}`;
    expect(await reply(noPass).dialIn({ roomId: "123456789", country: "NG" })).toMatchObject({ ok: true, data: { passcode: null, numbers: [{ kind: "toll_free", city: null }] } });
  });

  it("reuses the OAuth token until it nears expiry, then fetches a new one", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 60_000 });
    await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 60_000 });
    expect(fake.calls.filter((c) => c.path === "/oauth/token")).toHaveLength(1);
    fake.clock.now += 3_600_000;
    await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 60_000 });
    expect(fake.calls.filter((c) => c.path === "/oauth/token")).toHaveLength(2);
  });

  it("ends a meeting and then deletes it so nobody can rejoin a scheduled one", async () => {
    const fake = createFakeZoom({ now: 1_800_000_000_000 });
    const z = zoomFor(fake);
    const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 600_000 });
    if (!room.ok) throw new Error("room");
    await z.endRoom(room.data.roomId, "clinician");
    expect(fake.calls.map((c) => `${c.method} ${c.path}`).slice(-2)).toEqual([`PUT /v2/meetings/${room.data.roomId}/status`, `DELETE /v2/meetings/${room.data.roomId}`]);
  });

  it("fails without leaking credentials when Zoom rejects the account", async () => {
    const fake = createFakeZoom();
    const z = createZoomVideo({ accountId: "acc", clientId: "cid", clientSecret: "the-client-secret", sdkKey: "k", sdkSecret: "s", fetch: async () => ({ status: 401, ok: false, text: async () => '{"reason":"Invalid client"}' }), now: () => fake.clock.now });
    const r = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 60_000 });
    expect(r).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(JSON.stringify(r)).not.toContain("the-client-secret");
  });

  it("rejects a token reply that has no access token, and a meeting reply that has no id", async () => {
    const now = () => 1_800_000_000_000;
    const base = { accountId: "a", clientId: "c", clientSecret: "s", sdkKey: "k", sdkSecret: "s", now };
    const noToken = createZoomVideo({ ...base, fetch: async () => ({ status: 200, ok: true, text: async () => "{}" }) });
    expect(await noToken.createRoom({ encounterRef: ENC, expiresAtMs: now() + 60_000 })).toMatchObject({ ok: false, error: { code: "bad_response" } });
    const noId = createZoomVideo({ ...base, fetch: async (u) => ({ status: 200, ok: true, text: async () => (u.includes("oauth") ? '{"access_token":"t"}' : "{}") }) });
    expect(await noId.createRoom({ encounterRef: ENC, expiresAtMs: now() + 60_000 })).toMatchObject({ ok: false, error: { code: "bad_response" } });
    const noTimes = createZoomVideo({ ...base, fetch: async (u) => ({ status: 200, ok: true, text: async () => (u.includes("oauth") ? '{"access_token":"t","expires_in":3600}' : "{}") }) });
    expect(await noTimes.joinToken({ roomId: "123456789", role: "patient", identity: ID, ttlSeconds: 60 })).toMatchObject({ ok: false, error: { code: "bad_response" } });
  });

  it("surfaces a retryable failure from ending a meeting, and a vendor failure from deleting it", async () => {
    const mk = (putStatus: number, deleteStatus: number) =>
      createZoomVideo({
        accountId: "a", clientId: "c", clientSecret: "s", sdkKey: "k", sdkSecret: "s", now: () => 1,
        fetch: async (u, init) => {
          if (u.includes("oauth")) return { status: 200, ok: true, text: async () => '{"access_token":"t"}' };
          const status = init.method === "PUT" ? putStatus : deleteStatus;
          return { status, ok: status < 300, text: async () => "{}" };
        },
      });
    expect(await mk(503, 204).endRoom("123456789", "clinician")).toMatchObject({ ok: false, error: { retryable: true } });
    expect(await mk(204, 500).endRoom("123456789", "clinician")).toMatchObject({ ok: false, error: { code: "vendor_error" } });
    // A refused delete after a successful end is worth repeating, because the room can be rejoined until it works.
    expect(await mk(204, 400).endRoom("123456789", "clinician")).toMatchObject({ ok: false, error: { retryable: true } });
    expect((await mk(400, 204).endRoom("123456789", "clinician")).ok).toBe(true);
    expect((await mk(404, 404).endRoom("123456789", "clinician")).ok).toBe(true);
  });

  it("will not verify webhooks without a secret, and reads a non-JSON or shapeless signed body safely", async () => {
    const fake = createFakeZoom();
    const none = zoomFor(fake, {});
    expect((await none.parseWebhook("{}", {}, 1))).toMatchObject({ ok: false, error: { code: "not_configured" } });
    const z = zoomFor(fake);
    const sign = async (raw: string) => {
      const ts = "1";
      const { hmacHex } = await import("../../../supabase/functions/_shared/integrations/crypto.ts");
      return { "x-zm-request-timestamp": ts, "x-zm-signature": `v0=${await hmacHex("SHA-256", fake.webhookSecret, `v0:${ts}:${raw}`)}` };
    };
    expect(await z.parseWebhook("nope", await sign("nope"), 1)).toMatchObject({ ok: false, error: { code: "bad_response" } });
    expect(await z.parseWebhook("[]", await sign("[]"), 1)).toEqual({ ok: true, data: null });
    const noTs = JSON.stringify({ event: "meeting.ended", payload: { object: { id: 123456789 } } });
    expect(await z.parseWebhook(noTs, await sign(noTs), 77)).toEqual({ ok: true, data: { kind: "room_ended", roomId: "123456789", atMs: 77 } });
  });

  describe("in-app SDK join", () => {
    const meeting = '"start_time":"2027-01-15T08:00:00Z","duration":30';

    it("returns the room passcode to a patient and no host key, and the host key to a clinician only", async () => {
      const fake = createFakeZoom({ now: 1_800_000_000_000 });
      const z = zoomFor(fake);
      const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 30 * 60_000 });
      if (!room.ok) throw new Error("room");
      const pat = await z.joinToken({ roomId: room.data.roomId, role: "patient", identity: ID, ttlSeconds: 600 });
      const doc = await z.joinToken({ roomId: room.data.roomId, role: "clinician", identity: ID, ttlSeconds: 600 });
      expect(pat).toMatchObject({ ok: true, data: { password: "pw123" } });
      expect(pat.ok && pat.data.zak).toBeUndefined();
      expect(doc).toMatchObject({ ok: true, data: { password: "pw123", zak: "zak_ttl600" } });
      // the host key is asked for with the token's own lifetime, never longer
      expect(fake.calls.filter((c) => c.path === "/v2/users/me/token")).toHaveLength(1);
      // neither credential is inside the signed token
      if (!doc.ok) throw new Error("token");
      expect(JSON.stringify(decode(doc.data.token))).not.toMatch(/pw123|zak_/);
    });

    it("backdates the token's issue time by 30 seconds for a slow device clock", async () => {
      const fake = createFakeZoom({ now: 1_800_000_000_000 });
      const z = zoomFor(fake);
      const room = await z.createRoom({ encounterRef: ENC, expiresAtMs: fake.clock.now + 30 * 60_000 });
      if (!room.ok) throw new Error("room");
      const pat = await z.joinToken({ roomId: room.data.roomId, role: "patient", identity: ID, ttlSeconds: 600 });
      if (!pat.ok) throw new Error("token");
      expect(decode(pat.data.token)["iat"]).toBe(1_800_000_000 - 30);
    });

    it("gives a token with no passcode when the meeting has none, and refuses a clinician token when the host key cannot be had", async () => {
      const now = () => Date.parse("2027-01-15T08:10:00Z");
      const base = { accountId: "a", clientId: "c", clientSecret: "s", sdkKey: "k", sdkSecret: "s", now };
      const okMeeting = async (u: string) => ({ status: 200, ok: true, text: async () => (u.includes("oauth") ? '{"access_token":"t","expires_in":3600}' : `{${meeting}}`) });
      const noPass = createZoomVideo({ ...base, fetch: okMeeting });
      const pat = await noPass.joinToken({ roomId: "123456789", role: "patient", identity: ID, ttlSeconds: 60 });
      expect(pat.ok && "password" in pat.data).toBe(false);
      // a host key reply with no token is a bad reply, not an empty key
      expect(await noPass.joinToken({ roomId: "123456789", role: "clinician", identity: ID, ttlSeconds: 60 })).toMatchObject({ ok: false, error: { code: "bad_response" } });
      // a clinician with no passcode still gets the host key
      const hostOnly = createZoomVideo({ ...base, fetch: async (u) => (u.includes("/users/me/token") ? { status: 200, ok: true, text: async () => '{"token":"zakx"}' } : okMeeting(u)) });
      const doc = await hostOnly.joinToken({ roomId: "123456789", role: "clinician", identity: ID, ttlSeconds: 60 });
      expect(doc).toMatchObject({ ok: true, data: { zak: "zakx" } });
      expect(doc.ok && "password" in doc.data).toBe(false);
      // Zoom refusing the host key (for example the app lacks the scope) is a failure the caller falls back from
      const refused = createZoomVideo({ ...base, fetch: async (u) => (u.includes("/users/me/token") ? { status: 400, ok: false, text: async () => "{}" } : okMeeting(u)) });
      expect(await refused.joinToken({ roomId: "123456789", role: "clinician", identity: ID, ttlSeconds: 60 })).toMatchObject({ ok: false });
    });

    it("webhook: carries the customer key we issued, and a keyed event with an unknown label is kept as a hint, not dropped", async () => {
      const fake = createFakeZoom();
      const z = zoomFor(fake);
      const key = "p0123456789abcdef0123456789abcdef012";
      const named = await fake.signedEvent("meeting.participant_joined", "123456789", "clinician", key);
      expect(await z.parseWebhook(named.rawBody, named.headers, 1)).toEqual({ ok: true, data: { kind: "participant_joined", roomId: "123456789", role: "clinician", atMs: fake.clock.now, customerKey: key } });
      const renamed = await fake.signedEvent("meeting.participant_left", "123456789", "Ada Obi", key);
      expect(await z.parseWebhook(renamed.rawBody, renamed.headers, 1)).toEqual({ ok: true, data: { kind: "participant_left", roomId: "123456789", role: "observer", atMs: fake.clock.now, customerKey: key } });
      // no key and no known label (a plain link joiner who typed a name) is still ignored
      const link = await fake.signedEvent("meeting.participant_joined", "123456789", "Ada Obi");
      expect(await z.parseWebhook(link.rawBody, link.headers, 1)).toEqual({ ok: true, data: null });
    });
  });

  it("delivers in-process events (connection quality from the device SDK) to subscribers", async () => {
    const z = zoomFor(createFakeZoom());
    const off = z.subscribe("123456789", () => undefined);
    off();
    expect(typeof off).toBe("function");
  });
});
