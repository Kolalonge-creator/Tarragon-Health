import { describe, expect, it, jest } from "@jest/globals";
import {
  createMockVideo,
  INITIAL_LADDER,
  stepLadder,
  type LadderInput,
  type LadderPolicy,
  type LadderState,
  type VideoProvider,
} from "@tarragon/integrations";
import { getProposedConfig } from "@tarragon/shared";
import { joinConsultation, requestDialIn, type RpcClient } from "./room";

// End to end: a consultation joined by both people, degraded to audio only, dropped, and moved to a dial-in phone call, against the
// real mock providers and the real ladder. The database side of the same functions is proved in
// packages/db/tests/s21_encounters_consultations.sql; here the database is an in-memory stand-in that keeps that contract.

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const PATIENT = "11111111-1111-4111-8111-111111111111";
const DOCTOR = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

type Evt = { kind: string; role: string; payload: Record<string, unknown> };
const T0 = 1_800_000_000_000;

function fakeDb(opts: { now: () => number; scheduledAt?: number; status?: string; mode?: "video" | "audio_only" | "phone" | null; raceLoser?: boolean }) {
  const scheduledAt = opts.scheduledAt ?? T0 + 5 * 60_000;
  const s = { status: opts.status ?? "scheduled", mode: opts.mode ?? null, roomId: null as string | null, events: [] as Evt[], opened: 0 };
  const view = () => ({
    encounter_id: ENC,
    patient_id: PATIENT,
    clinician_id: DOCTOR,
    status: s.status,
    final_media_mode: s.mode,
    join_opens_at: new Date(scheduledAt - 15 * 60_000).toISOString(),
    join_closes_at: new Date(scheduledAt + 60 * 60_000).toISOString(),
    joinable: ["scheduled", "waiting", "in_progress"].includes(s.status) && opts.now() >= scheduledAt - 15 * 60_000 && opts.now() <= scheduledAt + 60 * 60_000,
    session_minutes: 30,
    room: { provider: "mock", provider_room_id: s.roomId, state: s.roomId ? "open" : "pending", expires_at: null },
  });
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const bad = (message: string) => Promise.resolve({ data: null, error: { message } });
  const service: RpcClient = {
    rpc: (fn, args = {}) => {
      if (fn === "service_get_encounter_room") return ok(args.p_encounter === ENC ? view() : null);
      if (fn === "service_open_encounter_room") {
        s.opened += 1;
        if (opts.raceLoser) return ok({ provider: "mock", provider_room_id: "room_winner", state: "open", expires_at: null, created: false });
        if (!s.roomId) {
          s.roomId = String(args.p_room_id);
          return ok({ provider: "mock", provider_room_id: s.roomId, state: "open", expires_at: null, created: true });
        }
        return ok({ provider: "mock", provider_room_id: s.roomId, state: "open", expires_at: null, created: false });
      }
      if (fn === "service_record_join") {
        const role = String(args.p_role);
        s.events.push({ kind: "joined", role, payload: { mode: args.p_mode } });
        const both = ["patient", "clinician"].every((r) => s.events.some((e) => e.kind === "joined" && e.role === r));
        s.status = both ? "in_progress" : "waiting";
        return ok(null);
      }
      if (fn === "service_set_phone_mode") {
        s.mode = "phone";
        s.events.push({ kind: "mode_changed", role: "system", payload: { mode: "phone" } });
        return ok(null);
      }
      if (fn === "service_record_encounter_event") {
        s.events.push({ kind: String(args.p_kind), role: String(args.p_actor_role), payload: (args.p_payload ?? {}) as Record<string, unknown> });
        return ok(null);
      }
      return bad(`unknown ${fn}`);
    },
  };
  const user = (userId: string): RpcClient => ({
    rpc: (fn, args = {}) => {
      if (fn !== "report_encounter_event") return bad(`unknown ${fn}`);
      if (userId !== PATIENT && userId !== DOCTOR) return bad("not authorized");
      if (!["scheduled", "waiting", "in_progress"].includes(s.status)) return bad(`this consultation is ${s.status}`);
      const role = userId === PATIENT ? "patient" : "clinician";
      const payload = (args.p_payload ?? {}) as Record<string, unknown>;
      // what the database now enforces: an app session can report neither a join nor the phone mode
      if (args.p_kind === "joined") return bad("that event cannot be reported from the app");
      if (args.p_kind === "mode_changed" && payload.mode !== "video" && payload.mode !== "audio_only") return bad("mode must be video or audio_only");
      s.events.push({ kind: String(args.p_kind), role, payload });
      if (args.p_kind === "mode_changed") s.mode = payload.mode as "video" | "audio_only";
      return ok(null);
    },
  });
  return { s, service, user };
}

const ladderPolicy: LadderPolicy = {
  ...getProposedConfig<{ poorSamplesToDowngrade: number; goodSamplesToOfferVideo: number; poorBelowKbps: number }>("video.audio_fallback").value,
  reconnectGraceSeconds: getProposedConfig<{ reconnectGraceSeconds: number }>("consultations.policy").value.reconnectGraceSeconds,
};

function setup(o: Parameters<typeof fakeDb>[0] & { clock?: { now: number }; video?: VideoProvider } = { now: () => T0 }) {
  const clock = o.clock ?? { now: T0 };
  const db = fakeDb({ ...o, now: () => clock.now });
  const video = o.video ?? createMockVideo(() => clock.now);
  const deps = (userId: string) => ({ userId, userRpc: db.user(userId), serviceRpc: db.service, video, now: () => clock.now });
  return { db, video, deps, clock };
}

describe("joining a consultation", () => {
  it("opens the room once, gives each person their own link, and moves to in progress when both are in", async () => {
    const { db, deps } = setup();
    const doc = await joinConsultation(deps(DOCTOR), ENC, "video");
    expect(db.s.status).toBe("waiting");
    const pat = await joinConsultation(deps(PATIENT), ENC, "video");
    expect(doc.ok && pat.ok).toBe(true);
    if (!doc.ok || !pat.ok) return;
    expect(doc.url).toContain("as=clinician");
    expect(pat.url).toContain("as=patient");
    expect(doc.url).not.toBe(pat.url);
    expect(db.s.opened).toBe(1);
    expect(db.s.status).toBe("in_progress");
    expect(doc.recorded && pat.recorded).toBe(true);
    // no link or name travels into a stored event
    expect(JSON.stringify(db.s.events)).not.toMatch(/https?:|Okafor/);
  });

  it("answers a stranger and an unknown id exactly the same, and records nothing", async () => {
    const { db, deps } = setup();
    expect(await joinConsultation(deps(STRANGER), ENC, "video")).toEqual({ ok: false, reason: "not_found" });
    expect(await joinConsultation(deps(PATIENT), "99999999-9999-4999-8999-999999999999", "video")).toEqual({ ok: false, reason: "not_found" });
    expect(db.s.events).toHaveLength(0);
    expect(db.s.roomId).toBeNull();
  });

  it("will not open the room before the join window, and says when it opens", async () => {
    const { db, deps, clock } = setup({ now: () => T0, scheduledAt: T0 + 3 * 3_600_000 });
    const early = await joinConsultation(deps(PATIENT), ENC, "video");
    expect(early).toMatchObject({ ok: false, reason: "not_open" });
    expect(early.ok === false && early.reason === "not_open" && early.opensAt).toBe(new Date(T0 + 3 * 3_600_000 - 15 * 60_000).toISOString());
    expect(db.s.roomId).toBeNull();
    clock.now = T0 + 3 * 3_600_000 - 10 * 60_000;
    expect((await joinConsultation(deps(PATIENT), ENC, "video")).ok).toBe(true);
  });

  it("refuses a finished or cancelled consultation", async () => {
    for (const status of ["completed", "cancelled", "no_show_patient", "no_show_clinician", "failed"]) {
      const { deps } = setup({ now: () => T0, status });
      expect(await joinConsultation(deps(PATIENT), ENC, "video")).toEqual({ ok: false, reason: "closed" });
    }
  });

  it("ends its own room when another person's open won the race, so no orphan meeting stays open", async () => {
    const video = createMockVideo(() => T0);
    const endRoom = jest.spyOn(video, "endRoom");
    const { deps } = setup({ now: () => T0, raceLoser: true, video });
    // The winner's room is not one this mock vendor knows, so the link step fails; what matters here is the cleanup.
    await joinConsultation(deps(DOCTOR), ENC, "video");
    expect(endRoom).toHaveBeenCalledTimes(1);
    expect(endRoom.mock.calls[0]![1]).toBe("clinician");
  });

  it("reports a vendor failure without recording a join", async () => {
    const video = createMockVideo(() => T0);
    const { db, deps } = setup({ now: () => T0, video });
    video.failNextCall();
    expect(await joinConsultation(deps(PATIENT), ENC, "video")).toEqual({ ok: false, reason: "provider" });
    expect(db.s.events).toHaveLength(0);
    // the failure is retryable: the next try works
    expect((await joinConsultation(deps(PATIENT), ENC, "video")).ok).toBe(true);
  });

  it("reports a vendor failure when the room cannot be recorded, and when the link cannot be made", async () => {
    const a = setup({ now: () => T0 });
    const brokenService: RpcClient = { rpc: (fn, args) => (fn === "service_open_encounter_room" ? Promise.resolve({ data: null, error: { message: "boom" } }) : a.db.service.rpc(fn, args)) };
    expect(await joinConsultation({ ...a.deps(PATIENT), serviceRpc: brokenService }, ENC, "video")).toEqual({ ok: false, reason: "provider" });

    const video = createMockVideo(() => T0);
    const b = setup({ now: () => T0, video });
    const created = await video.createRoom({ encounterRef: ENC, expiresAtMs: T0 + 3_600_000 });
    if (!created.ok) throw new Error("room");
    b.db.s.roomId = "room_not_in_vendor";
    expect(await joinConsultation(b.deps(PATIENT), ENC, "video")).toEqual({ ok: false, reason: "provider" });
  });

  it("still hands over the link when the join could not be recorded, and says so", async () => {
    const { db, deps } = setup();
    const noRecord: RpcClient = { rpc: (fn, args) => (fn === "service_record_join" ? Promise.resolve({ data: null, error: { message: "down" } }) : db.service.rpc(fn, args)) };
    const r = await joinConsultation({ ...deps(PATIENT), serviceRpc: noRecord }, ENC, "video");
    expect(r).toMatchObject({ ok: true, recorded: false });
    expect(db.s.events).toHaveLength(0);
  });

  it("treats a lookup error as not found", async () => {
    const { deps } = setup();
    const broken: RpcClient = { rpc: () => Promise.resolve({ data: null, error: { message: "down" } }) };
    expect(await joinConsultation({ ...deps(PATIENT), serviceRpc: broken }, ENC, "video")).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("who may record a join, and when the dial-in numbers are given", () => {
  it("never asks the app session to record a join: the server does", async () => {
    const { db, deps } = setup();
    const userCalls: string[] = [];
    const watched = { ...deps(PATIENT), userRpc: { rpc: (fn: string, args?: Record<string, unknown>) => (userCalls.push(`${fn}:${String(args?.p_kind)}`), db.user(PATIENT).rpc(fn, args)) } as RpcClient };
    expect((await joinConsultation(watched, ENC, "video")).ok).toBe(true);
    expect(userCalls).toEqual([]);
    expect(db.s.events.some((e) => e.kind === "joined" && e.role === "patient")).toBe(true);
  });

  it("gives no dial-in numbers before the join window, and records nothing", async () => {
    const { db, deps, video } = setup({ now: () => T0, scheduledAt: T0 + 3 * 3_600_000 });
    const dial = jest.spyOn(video, "dialIn");
    expect(await requestDialIn(deps(PATIENT), ENC)).toEqual({ ok: false, reason: "not_open" });
    expect(dial).not.toHaveBeenCalled();
    expect(db.s.events).toHaveLength(0);
  });

  it("gives no dial-in numbers once the consultation is over", async () => {
    const { db, deps, video } = setup({ now: () => T0, status: "completed" });
    const dial = jest.spyOn(video, "dialIn");
    expect(await requestDialIn(deps(PATIENT), ENC)).toEqual({ ok: false, reason: "not_allowed" });
    expect(dial).not.toHaveBeenCalled();
    expect(db.s.events).toHaveLength(0);
  });
});

describe("the fallback ladder end to end", () => {
  it("video, then audio only when quality stays poor, then a phone call when the connection is lost", async () => {
    const { db, deps, clock } = setup();
    expect((await joinConsultation(deps(DOCTOR), ENC, "video")).ok).toBe(true);
    const first = await joinConsultation(deps(PATIENT), ENC, "video");
    expect(first).toMatchObject({ ok: true, mediaMode: "video" });
    expect(db.s.status).toBe("in_progress");

    // sustained poor quality drops the call to audio only; the page reports the change
    let ladder: LadderState = INITIAL_LADDER;
    const feed = async (input: LadderInput) => {
      const step = stepLadder(ladder, input, ladderPolicy);
      ladder = step.state;
      if (step.action === "to_audio_only") await deps(PATIENT).userRpc.rpc("report_encounter_event", { p_encounter: ENC, p_kind: "mode_changed", p_payload: { mode: "audio_only" } });
      return step.action;
    };
    expect(await feed({ kind: "sample", sample: { quality: "poor" }, atMs: clock.now })).toBeNull();
    expect(await feed({ kind: "sample", sample: { quality: "poor" }, atMs: clock.now })).toBeNull();
    expect(await feed({ kind: "sample", sample: { quality: "poor" }, atMs: clock.now })).toBe("to_audio_only");
    expect(db.s.mode).toBe("audio_only");

    // anyone rejoining now comes in audio first, even if they ask for video
    const rejoin = await joinConsultation(deps(PATIENT), ENC, "video");
    expect(rejoin).toMatchObject({ ok: true, mediaMode: "audio_only" });
    expect(rejoin.ok && rejoin.url).toContain("media=audio_only");

    // the connection is lost and does not come back inside the grace window
    expect(await feed({ kind: "lost", atMs: clock.now })).toBe("grace_started");
    clock.now += ladderPolicy.reconnectGraceSeconds * 1000;
    const action = stepLadder(ladder, { kind: "tick", atMs: clock.now }, ladderPolicy);
    expect(action.action).toBe("to_phone");

    // the patient is given a number to ring into the same room; nothing is rung from our side and nothing is stored
    const dial = await requestDialIn(deps(PATIENT), ENC);
    expect(dial).toMatchObject({ ok: true, dialIn: { numbers: [{ country: "NG" }] } });
    expect(db.s.events.map((e) => e.kind)).toContain("phone_requested");
    // we cannot see who dialled, so the consultation is not marked as on the phone, and the clinician can still be in the room
    expect(db.s.mode).toBe("audio_only");
    expect(await joinConsultation(deps(DOCTOR), ENC, "audio_only")).toMatchObject({ ok: true });
    // the numbers and passcode are handed to the person and never written to the event log
    expect(JSON.stringify(db.s.events)).not.toContain(dial.ok ? dial.dialIn.meetingId + dial.dialIn.numbers[0]!.number : "x");
    expect(JSON.stringify(db.s.events)).not.toMatch(/\+234/);
  });

  it("a connection that comes back inside the grace window never reaches the phone", async () => {
    const { db, deps, clock } = setup();
    await joinConsultation(deps(DOCTOR), ENC, "video");
    await joinConsultation(deps(PATIENT), ENC, "video");
    let ladder: LadderState = INITIAL_LADDER;
    ladder = stepLadder(ladder, { kind: "lost", atMs: clock.now }, ladderPolicy).state;
    clock.now += 30_000;
    const back = stepLadder(ladder, { kind: "restored", atMs: clock.now }, ladderPolicy);
    expect(back.action).toBe("reconnected");
    expect(stepLadder(back.state, { kind: "tick", atMs: clock.now + 10 * 60_000 }, ladderPolicy).action).toBeNull();
    expect(db.s.mode).toBeNull();
  });
});

describe("the dial-in fallback on its own", () => {
  it("lets the clinician ask too, and gives the same room's numbers", async () => {
    const { db, deps } = setup({ now: () => T0 });
    await joinConsultation(deps(DOCTOR), ENC, "video");
    expect(await requestDialIn(deps(DOCTOR), ENC)).toMatchObject({ ok: true });
    expect(db.s.events.some((e) => e.kind === "phone_requested" && e.role === "clinician")).toBe(true);
  });

  it("opens the room if nobody has yet, so the patient can dial in first", async () => {
    const { db, deps } = setup();
    expect(db.s.roomId).toBeNull();
    expect(await requestDialIn(deps(PATIENT), ENC)).toMatchObject({ ok: true });
    expect(db.s.roomId).not.toBeNull();
  });

  it("says the phone is unavailable when the vendor has no number, and records a code, never a number", async () => {
    const { db, deps, video } = setup();
    await joinConsultation(deps(PATIENT), ENC, "video");
    jest.spyOn(video, "dialIn").mockResolvedValueOnce({ ok: false, error: { code: "not_found", message: "No dial-in number for this country", retryable: false } });
    expect(await requestDialIn(deps(PATIENT), ENC)).toEqual({ ok: false, reason: "phone_unavailable" });
    expect(db.s.events.some((e) => e.kind === "phone_requested" && e.payload.reason_code === "dial_in_unavailable")).toBe(true);
    expect(JSON.stringify(db.s.events)).not.toMatch(/\+234/);
  });

  it("says the phone is unavailable when the room cannot be opened", async () => {
    const { deps, video } = setup();
    jest.spyOn(video, "createRoom").mockResolvedValueOnce({ ok: false, error: { code: "network", message: "x", retryable: true } });
    expect(await requestDialIn(deps(PATIENT), ENC)).toEqual({ ok: false, reason: "phone_unavailable" });
  });

  it("refuses a stranger, an unknown consultation and a finished one", async () => {
    const { db, deps } = setup();
    expect(await requestDialIn(deps(STRANGER), ENC)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await requestDialIn(deps(PATIENT), "99999999-9999-4999-8999-999999999999")).toEqual({ ok: false, reason: "not_allowed" });
    db.s.status = "completed";
    expect(await requestDialIn(deps(PATIENT), ENC)).toEqual({ ok: false, reason: "not_allowed" });
    expect(db.s.events).toHaveLength(0);
  });

  it("refuses when the consultation has no clinician yet", async () => {
    const { deps } = setup();
    const noClinician: RpcClient = {
      rpc: (fn, args) =>
        fn === "service_get_encounter_room"
          ? Promise.resolve({ data: { encounter_id: ENC, patient_id: PATIENT, clinician_id: null, status: "scheduled", final_media_mode: null, join_opens_at: "", join_closes_at: "", joinable: true, session_minutes: 30, room: null }, error: null })
          : Promise.resolve({ data: null, error: { message: `unexpected ${fn} ${JSON.stringify(args)}` } }),
    };
    expect(await requestDialIn({ ...deps(PATIENT), serviceRpc: noClinician }, ENC)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("refuses when the database will not record the request", async () => {
    const { db, deps } = setup();
    const refused: RpcClient = { rpc: (fn, args) => (fn === "report_encounter_event" ? Promise.resolve({ data: null, error: { message: "not allowed" } }) : db.user(PATIENT).rpc(fn, args)) };
    expect(await requestDialIn({ ...deps(PATIENT), userRpc: refused }, ENC)).toEqual({ ok: false, reason: "not_allowed" });
  });
});
