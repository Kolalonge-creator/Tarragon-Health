/**
 * My Health on the phone (S09x): the access log reads fail loudly rather than look empty, entries are described without clinical content, and the
 * lock-screen pass is off by default, held back until the CMO signs the field list, and carries no medicine, condition or allergen name.
 */
import * as SecureStore from "expo-secure-store";
import { describeAccessEntry, loadAccessLog, loadCachedPassEnabled, loadPassState, setPassEnabled } from "./my-health";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
const rpc = supabase.rpc as unknown as jest.Mock;

const FACTS = {
  enabled: true,
  fields_signed: true,
  fields: ["initials", "blood_group", "genotype", "genotype_provenance", "allergies_on_file", "emergency_contact_phone", "unlock_hint"],
  initials: "AB",
  blood_group: "O+",
  genotype: "AS",
  genotype_provenance: "patient_attested",
  allergies_on_file: true,
  emergency_contact_phone: "+2348012345678",
};

beforeEach(() => {
  rpc.mockReset();
  jest.clearAllMocks();
});

describe("loadAccessLog", () => {
  it("returns entries, and an error is a failure, not an empty list", async () => {
    rpc.mockResolvedValueOnce({ data: [{ at: "2026-10-13T10:00:00Z", kind: "share_opened", actor_label: "x", actor_name: null, categories: ["vitals"], status: null, ends_at: null }], error: null });
    const ok = await loadAccessLog();
    expect(ok.ok && ok.entries.length).toBe(1);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "no" } });
    expect(await loadAccessLog()).toEqual({ ok: false });
    rpc.mockResolvedValueOnce({ data: { odd: true }, error: null });
    expect(await loadAccessLog()).toEqual({ ok: false });
  });

  it("passes the cursor", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await loadAccessLog("2026-10-13T10:00:00Z");
    expect(rpc).toHaveBeenCalledWith("my_access_log", { p_before: "2026-10-13T10:00:00Z" });
  });
});

describe("describeAccessEntry", () => {
  it("describes who and what kind, with no raw keys", () => {
    const d = describeAccessEntry({ at: "x", kind: "emergency_access_grant", actor_label: "Person you allowed to use emergency access", actor_name: "Ada B", categories: ["emergency_access"], status: "active", ends_at: null });
    expect(d.title).toBe("Emergency access was used for your record");
    expect(d.who).toBe("Ada B (Person you allowed to use emergency access)");
    expect(d.status).toBe("Still active");
  });

  it("falls back to neutral words for anything unknown", () => {
    const d = describeAccessEntry({ at: "x", kind: "brand_new", actor_label: "Someone", actor_name: null, categories: ["mystery"], status: "weird", ends_at: null });
    expect(JSON.stringify(d)).not.toContain("my_health.");
    expect(d.status).toBeNull();
  });
});

describe("lock-screen pass", () => {
  it("is off by default and the cached setting is false when unknown", async () => {
    expect(await loadCachedPassEnabled()).toBe(false);
    rpc.mockResolvedValueOnce({ data: { enabled: false, fields_signed: true }, error: null });
    const r = await loadPassState();
    expect(r.ok && r.state.devicePayload).toBeNull();
    expect(r.ok && r.state.cardPayload).toBeNull();
  });

  it("holds the device version back until the field list is signed, but the patient's own card is available", async () => {
    rpc.mockResolvedValueOnce({ data: { ...FACTS, fields_signed: false }, error: null });
    const r = await loadPassState();
    expect(r.ok && r.state.devicePayload).toBeNull();
    expect(r.ok && r.state.cardPayload?.rows.length).toBeGreaterThan(0);
  });

  it("carries no medicine, condition or allergen name even if the server leaked one", async () => {
    rpc.mockResolvedValueOnce({ data: { ...FACTS, allergies_on_file: "penicillin", medications: ["metformin"], conditions: ["hypertension"] }, error: null });
    const r = await loadPassState();
    const text = JSON.stringify(r.ok ? r.state.devicePayload : null).toLowerCase();
    for (const w of ["penicillin", "metformin", "hypertension"]) expect(text).not.toContain(w);
  });

  it("a failed read is a failure", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadPassState()).toEqual({ ok: false });
  });

  it("setPassEnabled reports a server failure and does not cache a setting the server refused", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "nope" } });
    expect(await setPassEnabled(true)).toEqual({ error: "nope" });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith("lock-screen-pass-enabled-v1", "true");
  });
});
