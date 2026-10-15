/**
 * S70a on the phone: the photo reading path (confirm every digit, numbers only, offline queue), held readings, the whose-device picker, the
 * ECG classification sync and the new api calls. Pure logic: no screen is rendered (see jest.config.mjs).
 */
jest.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn() }));
jest.mock("./supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn(), signOut: jest.fn() }, from: jest.fn(), rpc: jest.fn() } }));
jest.mock("./acting", () => ({ loadPeopleISupport: jest.fn() }));
jest.mock("./healthkit", () => ({ loadHealthkit: jest.fn() }));

import * as ImagePicker from "expo-image-picker";
import { draftFromRecognisedText } from "@tarragon/shared";
import { supabase } from "./supabase";
import { loadPeopleISupport } from "./acting";
import { loadHealthkit } from "./healthkit";
import {
  NETWORK_ERROR_MESSAGE,
  postDeviceReading,
  postDeviceRhythmResult,
  postPhotoReading,
  type PhotoReadingRequest,
} from "./api";
import {
  buildPhotoRequest,
  draftFromPhoto,
  finalisePhotoReading,
  hasTextRecogniser,
  registerTextRecogniser,
  takeDevicePhoto,
} from "./photo-capture";
import { discardHeldReading, loadHeldReadings, summariseHeld } from "./held-readings";
import { loadRecommendedDevices } from "./recommended-devices";
import { buildSubjects, loadReadingSubjects, ownersOfDevice } from "./reading-subject";
import { HEALTHKIT_ECG_LABEL, labelFor, readEcgClassifications, syncEcgResults } from "./healthkit-ecg";
import { loadDeviceFlags, NO_DEVICE_FLAGS } from "./device-flags";
import { enqueuePhotoReading, flushPhotoReadingsQueue, getPendingCount, listPendingPhotoReadings } from "./offline-queue";
import { getRecentSyncDiagnostics } from "./sync-diagnostics";

const sb = supabase as unknown as { auth: { getSession: jest.Mock }; from: jest.Mock; rpc: jest.Mock };
const mockFetch = jest.fn();

function signedIn() {
  sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
}
function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
const request = (over: Partial<PhotoReadingRequest> = {}): PhotoReadingRequest => ({
  client_reading_id: "11111111-1111-4111-8111-111111111111",
  taken_at: "2026-10-07T10:00:00.000Z",
  confirmed: true,
  reading: { vital_type: "blood_pressure", systolic: 128, diastolic: 82 },
  ...over,
});

beforeEach(() => {
  signedIn();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
  registerTextRecogniser(null);
});

describe("photo capture", () => {
  it("has no recogniser until one is registered, and still gives empty boxes to type into", async () => {
    expect(hasTextRecogniser()).toBe(false);
    const draft = await draftFromPhoto("blood_pressure", "file:///photo.jpg");
    expect(draft.fields.every((f) => f.value === "" && !f.suggested)).toBe(true);
  });

  it("uses a registered recogniser's text as suggestions, never as a reading", async () => {
    registerTextRecogniser({ recognise: async () => ["SYS", "128", "DIA", "82", "PUL", "71"] });
    const draft = await draftFromPhoto("blood_pressure", "file:///photo.jpg");
    expect(draft.fields.map((f) => [f.field, f.value, f.suggested])).toEqual([["systolic", "128", true], ["diastolic", "82", true], ["pulse_bpm", "71", true]]);
    expect(finalisePhotoReading({ draft, edits: {}, confirmedFields: [] }).ok).toBe(false);
  });

  it("a recogniser that throws is the same as one that finds nothing", async () => {
    registerTextRecogniser({ recognise: async () => { throw new Error("native module missing"); } });
    const draft = await draftFromPhoto("glucose", "file:///photo.jpg");
    expect(draft.fields[0]?.value).toBe("");
  });

  it("builds the request from a confirmed reading: numbers only, confirmed true, the supporter's person named, an idempotency key", () => {
    const draft = draftFromRecognisedText("blood_pressure", ["128", "82", "71"]);
    const done = finalisePhotoReading({ draft, edits: {}, confirmedFields: ["systolic", "diastolic", "pulse_bpm"] });
    if (!done.ok || done.held) throw new Error("expected a reading");
    const req = buildPhotoRequest(done.reading, new Date("2026-10-07T10:00:00Z"), "person-2", "22222222-2222-4222-8222-222222222222");
    expect(req).toEqual({
      client_reading_id: "22222222-2222-4222-8222-222222222222",
      taken_at: "2026-10-07T10:00:00.000Z",
      confirmed: true,
      patient_id: "person-2",
      reading: { vital_type: "blood_pressure", systolic: 128, diastolic: 82, pulse_bpm: 71 },
    });
    expect(JSON.stringify(req)).not.toMatch(/file:|uri|image|photo/i);
  });

  it("the camera: permission denied, cancelled, and a taken picture", async () => {
    const picker = ImagePicker as unknown as { requestCameraPermissionsAsync: jest.Mock; launchCameraAsync: jest.Mock };
    picker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    expect(await takeDevicePhoto()).toEqual({ ok: false, reason: "denied" });
    picker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: true });
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    expect(await takeDevicePhoto()).toEqual({ ok: false, reason: "cancelled" });
    picker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: true });
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///x.jpg" }] });
    expect(await takeDevicePhoto()).toEqual({ ok: true, uri: "file:///x.jpg" });
    picker.requestCameraPermissionsAsync.mockRejectedValueOnce(new Error("no camera"));
    expect(await takeDevicePhoto()).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("api: new calls", () => {
  it("postDeviceReading reports held and merged only when true, so nothing changes with the switches off", async () => {
    mockFetch.mockResolvedValueOnce(res(200, { success: true }));
    expect(await postDeviceReading({ a: 1 })).toEqual({ success: true });
    mockFetch.mockResolvedValueOnce(res(200, { success: true, held: true }));
    expect(await postDeviceReading({ a: 1 })).toEqual({ success: true, held: true });
    mockFetch.mockResolvedValueOnce(res(200, { success: true, merged: true }));
    expect(await postDeviceReading({ a: 1 })).toEqual({ success: true, merged: true });
  });

  it("postPhotoReading: saved, held, merged, and an outage is marked offline", async () => {
    mockFetch.mockResolvedValueOnce(res(200, { success: true }));
    expect(await postPhotoReading(request())).toEqual({ ok: true, held: false, merged: false, deduped: false });
    mockFetch.mockResolvedValueOnce(res(200, { success: true, held: true, held_id: "h1", reasons: ["systolic_range"] }));
    expect(await postPhotoReading(request())).toEqual({ ok: true, held: true, heldId: "h1", reasons: ["systolic_range"] });
    mockFetch.mockResolvedValueOnce(res(200, { success: true, merged: true }));
    expect(await postPhotoReading(request())).toMatchObject({ ok: true, merged: true });
    mockFetch.mockRejectedValue(new Error("offline"));
    const offline = await postPhotoReading(request());
    expect(offline).toMatchObject({ ok: false, offline: true, error: NETWORK_ERROR_MESSAGE });
  });

  it("postDeviceRhythmResult hands back only the fixed sentence and the red-path flag", async () => {
    mockFetch.mockResolvedValueOnce(res(200, { success: true, duplicate: false, patient_copy: "Your device flagged something for your care team to look at.", red_path: true }));
    expect(await postDeviceRhythmResult({ source: "healthkit_ecg", device_label: "x", recorded_at: "2026-10-07T10:00:00Z", external_id: "e" })).toEqual({
      ok: true, duplicate: false, patientCopy: "Your device flagged something for your care team to look at.", redPath: true,
    });
    mockFetch.mockResolvedValueOnce(res(404, { error: "not switched on" }));
    expect(await postDeviceRhythmResult({ source: "healthkit_ecg", device_label: "x", recorded_at: "2026-10-07T10:00:00Z", external_id: "e" })).toMatchObject({ ok: false, status: 404, offline: false });
  });
});

describe("photo readings offline queue", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("holds the confirmed numbers while offline, counts them as pending, and sends them once, then removes them", async () => {
    expect(await enqueuePhotoReading(request())).toBe(true);
    expect(await getPendingCount()).toBe(1);
    mockFetch.mockResolvedValue(res(200, { success: true }));
    expect(await flushPhotoReadingsQueue()).toEqual({ flushed: 1, remaining: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("stops at the first outage and keeps every entry", async () => {
    await enqueuePhotoReading(request({ client_reading_id: "a" }));
    await enqueuePhotoReading(request({ client_reading_id: "b" }));
    mockFetch.mockRejectedValue(new Error("offline"));
    const result = await flushPhotoReadingsQueue();
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(2);
  });

  it("drops a reading the server REFUSES (so it cannot block the rest) and records it", async () => {
    await enqueuePhotoReading(request({ client_reading_id: "bad" }));
    await enqueuePhotoReading(request({ client_reading_id: "good" }));
    mockFetch.mockResolvedValueOnce(res(422, { error: "This photo is more than 7 days old" })).mockResolvedValue(res(200, { success: true }));
    const result = await flushPhotoReadingsQueue();
    expect(result).toEqual({ flushed: 1, remaining: 0 });
    expect(getRecentSyncDiagnostics().some((d) => /7 days/.test(JSON.stringify(d)))).toBe(true);
  });

  it("keeps a reading the server answered 404 (the switch may be turned on later) and 5xx", async () => {
    await enqueuePhotoReading(request());
    mockFetch.mockResolvedValue(res(404, { error: "not switched on" }));
    expect((await flushPhotoReadingsQueue()).remaining).toBe(1);
    expect((await listPendingPhotoReadings())[0]?.item.confirmed).toBe(true);
  });
});

describe("held readings", () => {
  it("summarises each kind in its own unit", () => {
    expect(summariseHeld("blood_pressure", { systolic: 320, diastolic: 90 })).toBe("320/90 mmHg");
    expect(summariseHeld("glucose", { glucose_mmol_l: 60 })).toBe("60 mmol/L");
    expect(summariseHeld("ketones", {})).toBe("a reading");
  });

  it("a failed load is not 'nothing waiting'", async () => {
    const chain: Record<string, jest.Mock> = {};
    for (const m of ["select", "eq", "order"]) chain[m] = jest.fn(() => chain);
    chain.limit = jest.fn(async () => ({ data: null, error: new Error("boom") }));
    sb.from.mockReturnValue(chain);
    expect(await loadHeldReadings("p1")).toEqual({ ok: false });
    chain.limit.mockResolvedValueOnce({ data: [{ id: "h1", vital_type: "pulse", source: "device", payload: { pulse_bpm: 300 }, created_at: "t" }], error: null });
    expect(await loadHeldReadings("p1")).toEqual({ ok: true, items: [{ id: "h1", vitalType: "pulse", source: "device", summary: "300 bpm", createdAt: "t" }] });
  });

  it("discarding reports whether it worked", async () => {
    sb.rpc.mockResolvedValueOnce({ error: null });
    expect(await discardHeldReading("h1")).toBe(true);
    expect(sb.rpc).toHaveBeenCalledWith("resolve_held_reading", { p_id: "h1", p_state: "discarded" });
    sb.rpc.mockResolvedValueOnce({ error: { message: "no" } });
    expect(await discardHeldReading("h1")).toBe(false);
  });
});

describe("recommended devices and switches", () => {
  it("lists what the server returns with its evidence, and says so when it cannot load", async () => {
    sb.rpc.mockResolvedValueOnce({ data: [{ id: "d1", device_name: "Cuff", category: "blood_pressure", vendor_name: "V", description: null, validated_source_url: "https://x.example/v", validation_basis: "validatebp", nafdac_number: "A0-1", authorised_distributor: null }], error: null });
    expect(await loadRecommendedDevices()).toEqual({ ok: true, items: [{ id: "d1", name: "Cuff", category: "blood_pressure", vendor: "V", description: null, validatedSourceUrl: "https://x.example/v", validationBasis: "validatebp", nafdacNumber: "A0-1", authorisedDistributor: null }] });
    sb.rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadRecommendedDevices()).toEqual({ ok: false });
  });

  it("every switch reads off when it cannot be read", async () => {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn(() => chain);
    chain.like = jest.fn(async () => ({ data: null, error: new Error("offline") }));
    sb.from.mockReturnValue(chain);
    expect(await loadDeviceFlags()).toEqual(NO_DEVICE_FLAGS);
    chain.like.mockResolvedValueOnce({ data: [{ key: "device_photo_capture", is_enabled: true }, { key: "not_a_device_key", is_enabled: true }], error: null });
    expect((await loadDeviceFlags()).device_photo_capture).toBe(true);
  });
});

describe("whose device is this?", () => {
  it("offers the person and only those they can manage", () => {
    const subjects = buildSubjects("me", [
      { profileId: "mum", fullName: "Mum", permissionLevel: "manage" },
      { profileId: "dad", fullName: "Dad", permissionLevel: "view" },
      { profileId: "me", fullName: "Me", permissionLevel: "manage" },
      { profileId: "kid", fullName: null, permissionLevel: "manage" },
    ]);
    expect(subjects.map((s) => [s.profileId, s.label, s.isSelf])).toEqual([["me", "Mine", true], ["mum", "Mum", false], ["kid", "Someone you support", false]]);
  });

  it("falls back to just the person when the list cannot load: a convenience, never a gate", async () => {
    (loadPeopleISupport as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    expect(await loadReadingSubjects("me")).toEqual([{ profileId: "me", label: "Mine", isSelf: true }]);
  });

  it("asks whose reading it is only when more than one person has this device paired", () => {
    const rows = [{ ble_device_id: "cuff", patient_id: "me" }, { ble_device_id: "cuff", patient_id: "mum" }, { ble_device_id: "cuff", patient_id: "mum" }, { ble_device_id: "other", patient_id: "me" }];
    expect(ownersOfDevice("cuff", rows).sort()).toEqual(["me", "mum"]);
    expect(ownersOfDevice("other", rows)).toEqual(["me"]);
    expect(ownersOfDevice("none", rows)).toEqual([]);
  });
});

describe("ECG classifications from the phone's health data", () => {
  it("stores the device's own words, and never invents a diagnosis for a class it does not know", () => {
    expect(labelFor("atrialFibrillation")).toBe("Atrial fibrillation");
    expect(labelFor("inconclusivePoorReading")).toBe("Inconclusive: poor recording");
    expect(labelFor("somethingNew")).toBe("Unrecognised: somethingNew");
    expect(Object.keys(HEALTHKIT_ECG_LABEL)).toHaveLength(7);
  });

  it("is unavailable (null), not an error, when HealthKit is not there", async () => {
    (loadHealthkit as jest.Mock).mockReturnValue(null);
    expect(await readEcgClassifications(new Date())).toBeNull();
  });

  it("sends each classification once, counts duplicates and failures, and carries the red-path flag and the fixed sentence", async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, duplicate: false, patientCopy: "Your device flagged something for your care team to look at.", redPath: false })
      .mockResolvedValueOnce({ ok: true, duplicate: true, patientCopy: null, redPath: true })
      .mockResolvedValueOnce({ ok: false, error: "x", offline: true });
    const out = await syncEcgResults(
      [
        { uuid: "a", startDate: new Date("2026-10-07T10:00:00Z"), classification: "atrialFibrillation" },
        { uuid: "b", startDate: new Date("2026-10-07T11:00:00Z"), classification: "sinusRhythm" },
        { uuid: "c", startDate: new Date("2026-10-07T12:00:00Z"), classification: "inconclusiveOther" },
      ],
      { send, symptoms: ["chest_pain"] },
    );
    expect(out).toEqual({ sent: 1, duplicates: 1, failed: 1, redPath: true, patientCopy: "Your device flagged something for your care team to look at." });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ source: "healthkit_ecg", device_label: "Atrial fibrillation", external_id: "a", symptoms: ["chest_pain"] }));
  });
});
