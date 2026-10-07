const signatureMock = jest.fn();
jest.mock("./signature", () => ({ loadPrescriberSignature: (...args: unknown[]) => signatureMock(...args) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadLetterhead, loadPrescriptionBundle, loadPrescriptionForClinician, loadSinglePrescription } from "./load-prescription-pdf-data";
import { DEFAULT_LETTERHEAD } from "./letterhead";

const PATIENT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const PRESCRIBER = "44444444-4444-4444-8444-444444444444";

function med(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organisation_id: "55555555-5555-4555-8555-555555555555",
    patient_id: PATIENT,
    source: "clinician",
    is_active: true,
    drug_name: "Amlodipine",
    dose: "5 mg",
    frequency: "Once daily",
    route: "Oral",
    quantity: "30 tablets",
    duration_days: 30,
    repeats_allowed: 1,
    indication: null,
    instructions: null,
    rx_number: "TRG-RX-2026-000366",
    verification_code: "A1B2C3",
    expires_at: "2099-01-01T00:00:00Z",
    version: 1,
    superseded_at: null,
    created_at: "2026-10-01T09:00:00Z",
    amendment_reason: null,
    public_token: "c".repeat(64),
    added_by: PRESCRIBER,
    ...overrides,
  };
}

interface Fixture {
  meds: unknown[];
  patient: unknown;
  staff: unknown;
  auditError: { message: string } | null;
}

/** A chainable stand-in for the query builder: every filter returns itself, awaiting or maybeSingle() resolves the fixture. */
function fakeClient(fixture: Fixture, rpcResult?: { data: unknown; error: { message: string } | null }) {
  const audit: unknown[][] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const resolve = () => {
      if (table === "medications") return { data: fixture.meds, error: null };
      return { data: null, error: null };
    };
    for (const method of ["select", "eq", "is", "order"]) chain[method] = () => chain;
    chain.maybeSingle = async () => {
      if (table === "medications") return { data: fixture.meds[0] ?? null, error: null };
      if (table === "clinical_staff_directory") return { data: fixture.staff, error: null };
      if (table === "profiles") return { data: fixture.patient, error: null };
      return { data: null, error: null };
    };
    chain.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled);
    if (table === "audit_log") {
      chain.insert = async (rows: unknown[]) => {
        audit.push(rows);
        return { error: fixture.auditError };
      };
    }
    return chain;
  };
  const rpc = async () => rpcResult ?? { data: null, error: null };
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, audit };
}

const goodStaff = { full_name: "Dr Ada Longe", credential_type: "MDCN", credential_number: "123456", license_verified: true };
const goodPatient = { full_name: "First Patient", patient_number: "TH-002610", date_of_birth: "1985-03-04" };

beforeEach(() => {
  signatureMock.mockReset().mockResolvedValue(null);
});

describe("prescriber name", () => {
  it("comes from the staff directory, not from profiles (which a patient cannot read), with a leading title removed", async () => {
    const { client } = fakeClient({ meds: [med()], patient: goodPatient, staff: goodStaff, auditError: null });
    const result = await loadSinglePrescription(client, ACTOR, "11111111-1111-4111-8111-111111111111", "web");
    expect(result.status === "ok" && result.prescriptions[0]?.prescriberName).toBe("Ada Longe");
    expect(result.status === "ok" && result.prescriptions[0]?.prescriberName).not.toBe("First Patient");
  });

  it("is refused when the directory row has no name, rather than printing a blank prescriber", async () => {
    const { client } = fakeClient({ meds: [med()], patient: goodPatient, staff: { ...goodStaff, full_name: null }, auditError: null });
    expect(await loadSinglePrescription(client, ACTOR, "11111111-1111-4111-8111-111111111111", "web")).toMatchObject({ reason: "prescriber_unverified" });
  });
});

describe("signature embedding", () => {
  const MEDID = "11111111-1111-4111-8111-111111111111";
  it("attaches the prescriber's signature to an issued prescription, looked up by the prescriber's profile", async () => {
    signatureMock.mockResolvedValue("data:image/png;base64,AAAA");
    const { client } = fakeClient({ meds: [med()], patient: goodPatient, staff: goodStaff, auditError: null });
    const result = await loadSinglePrescription(client, ACTOR, MEDID, "web");
    expect(result.status === "ok" && result.prescriptions[0]?.signatureImage).toBe("data:image/png;base64,AAAA");
    expect(signatureMock).toHaveBeenCalledWith(PRESCRIBER);
  });

  it("issues with no signature when there is none", async () => {
    const { client } = fakeClient({ meds: [med()], patient: goodPatient, staff: goodStaff, auditError: null });
    const result = await loadSinglePrescription(client, ACTOR, MEDID, "web");
    expect(result.status === "ok" && result.prescriptions[0]?.signatureImage).toBeNull();
  });

  it("never fetches the signature for a prescription that is refused, or when the audit write fails", async () => {
    const refused = fakeClient({ meds: [med({ superseded_at: "2026-09-30T00:00:00Z", is_active: false })], patient: goodPatient, staff: goodStaff, auditError: null });
    await loadSinglePrescription(refused.client, ACTOR, MEDID, "web");
    const unaudited = fakeClient({ meds: [med()], patient: goodPatient, staff: goodStaff, auditError: { message: "denied" } });
    await loadSinglePrescription(unaudited.client, ACTOR, MEDID, "web");
    const hiddenRow = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null });
    await loadSinglePrescription(hiddenRow.client, ACTOR, MEDID, "web");
    expect(signatureMock).not.toHaveBeenCalled();
  });

  it("looks up each prescriber once for a bundle", async () => {
    signatureMock.mockResolvedValue("data:image/png;base64,BBBB");
    const { client } = fakeClient({
      meds: [med(), med({ id: "66666666-6666-4666-8666-666666666666", drug_name: "Metformin", rx_number: "TRG-RX-2026-000367" })],
      patient: goodPatient,
      staff: goodStaff,
      auditError: null,
    });
    const result = await loadPrescriptionBundle(client, ACTOR, PATIENT, "web");
    expect(result.status === "ok" && result.prescriptions.every((p) => p.signatureImage === "data:image/png;base64,BBBB")).toBe(true);
    expect(signatureMock).toHaveBeenCalledTimes(1);
  });
});

describe("loadLetterhead", () => {
  it("reads the registered company details and falls back to the TarragonHealth name when unavailable", async () => {
    const good = { client: { rpc: async () => ({ data: { trading_name: "TarragonHealth", legal_name: "Tarragon Health Ltd", rc_number: "123456", registered_address: "Lagos", registered_email: "a@b.ng", registered_phone: "+234" }, error: null }) } as unknown as SupabaseClient<Database> };
    expect(await loadLetterhead(good.client)).toMatchObject({ tradingName: "TarragonHealth", legalName: "Tarragon Health Ltd", rcNumber: "123456", address: "Lagos" });
    const failing = { rpc: async () => ({ data: null, error: { message: "x" } }) } as unknown as SupabaseClient<Database>;
    expect(await loadLetterhead(failing)).toEqual(DEFAULT_LETTERHEAD);
    const throwing = { rpc: async () => { throw new Error("boom"); } } as unknown as SupabaseClient<Database>;
    expect(await loadLetterhead(throwing)).toEqual(DEFAULT_LETTERHEAD);
    const empty = { rpc: async () => ({ data: {}, error: null }) } as unknown as SupabaseClient<Database>;
    expect(await loadLetterhead(empty)).toEqual(DEFAULT_LETTERHEAD);
  });
});

describe("loadSinglePrescription", () => {
  it("issues and writes one audit row naming the caller, the patient and the Rx number", async () => {
    const { client, audit } = fakeClient({ meds: [med()], patient: goodPatient, staff: goodStaff, auditError: null });
    const result = await loadSinglePrescription(client, ACTOR, "11111111-1111-4111-8111-111111111111", "web");
    expect(result.status).toBe("ok");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual([
      expect.objectContaining({
        actor_id: ACTOR,
        action: "prescription.pdf_downloaded",
        entity_type: "medications",
        subject_patient_id: PATIENT,
        result: "success",
        event: { rx_number: "TRG-RX-2026-000366", version: 1, channel: "web", bundle: false, via: "patient" },
      }),
    ]);
  });

  it("returns not found when the caller cannot read the row (RLS filters it), with no audit row", async () => {
    const { client, audit } = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null });
    const result = await loadSinglePrescription(client, ACTOR, "11111111-1111-4111-8111-111111111111", "web");
    expect(result).toEqual({ status: "not_found" });
    expect(audit).toHaveLength(0);
  });

  it("refuses a superseded prescription and writes no audit row", async () => {
    const { client, audit } = fakeClient({
      meds: [med({ superseded_at: "2026-09-30T00:00:00Z", is_active: false })],
      patient: goodPatient,
      staff: goodStaff,
      auditError: null,
    });
    const result = await loadSinglePrescription(client, ACTOR, "11111111-1111-4111-8111-111111111111", "mobile");
    expect(result).toMatchObject({ status: "refused", reason: "superseded" });
    expect(audit).toHaveLength(0);
  });

  it("refuses when the prescriber directory row is not visible or not verified", async () => {
    const hidden = fakeClient({ meds: [med()], patient: goodPatient, staff: null, auditError: null });
    expect(await loadSinglePrescription(hidden.client, ACTOR, "x", "web")).toMatchObject({ reason: "prescriber_unverified" });
    const placeholder = fakeClient({
      meds: [med()],
      patient: goodPatient,
      staff: { ...goodStaff, credential_number: "MDCN-PENDING-1" },
      auditError: null,
    });
    expect(await loadSinglePrescription(placeholder.client, ACTOR, "x", "web")).toMatchObject({ reason: "prescriber_unverified" });
  });

  it("fails closed when the audit row cannot be written: nothing is issued", async () => {
    const { client } = fakeClient({ meds: [med()], patient: goodPatient, staff: goodStaff, auditError: { message: "denied" } });
    const result = await loadSinglePrescription(client, ACTOR, "x", "web");
    expect(result.status).toBe("error");
  });
});

describe("loadPrescriptionBundle", () => {
  it("includes each issuable prescription and audits each one", async () => {
    const { client, audit } = fakeClient({
      meds: [med(), med({ id: "66666666-6666-4666-8666-666666666666", drug_name: "Metformin", rx_number: "TRG-RX-2026-000367" })],
      patient: goodPatient,
      staff: goodStaff,
      auditError: null,
    });
    const result = await loadPrescriptionBundle(client, ACTOR, PATIENT, "web");
    expect(result.status === "ok" && result.prescriptions.map((p) => p.drugName)).toEqual(["Amlodipine", "Metformin"]);
    expect(audit[0]).toHaveLength(2);
    expect(audit[0]?.[0]).toMatchObject({ event: { bundle: true } });
  });

  it("skips and reports a controlled medicine rather than printing it", async () => {
    const { client } = fakeClient({
      meds: [med(), med({ id: "66666666-6666-4666-8666-666666666666", drug_name: "Codeine phosphate", rx_number: "TRG-RX-2026-000368" })],
      patient: goodPatient,
      staff: goodStaff,
      auditError: null,
    });
    const result = await loadPrescriptionBundle(client, ACTOR, PATIENT, "web");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.prescriptions).toHaveLength(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({ drugName: "Codeine phosphate", reason: "controlled_medicine" }),
    ]);
  });

  it("returns not found when there are no current prescriptions", async () => {
    const { client } = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null });
    expect(await loadPrescriptionBundle(client, ACTOR, PATIENT, "web")).toEqual({ status: "not_found" });
  });

  it("refuses with the reason when nothing in the bundle may be issued", async () => {
    const { client } = fakeClient({ meds: [med({ drug_name: "Tramadol" })], patient: goodPatient, staff: goodStaff, auditError: null });
    expect(await loadPrescriptionBundle(client, ACTOR, PATIENT, "web")).toMatchObject({ status: "refused", reason: "controlled_medicine" });
  });
});

describe("loadPrescriptionForClinician", () => {
  const ok = (rows: unknown[]) => ({ data: { status: "ok", rows }, error: null });
  const MED = "11111111-1111-4111-8111-111111111111";

  it("issues through the audited read and audits the clinician as actor with via: clinician", async () => {
    const { client, audit } = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null }, ok([med()]));
    const result = await loadPrescriptionForClinician(client, ACTOR, PATIENT, MED);
    expect(result.status).toBe("ok");
    expect(audit[0]?.[0]).toMatchObject({ actor_id: ACTOR, action: "prescription.pdf_downloaded", event: { via: "clinician", bundle: false } });
  });

  it("answers not found when the tie gate denies the read, and writes no download audit", async () => {
    const { client, audit } = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null }, { data: { status: "denied" }, error: null });
    expect(await loadPrescriptionForClinician(client, ACTOR, PATIENT, MED)).toEqual({ status: "not_found" });
    expect(audit).toHaveLength(0);
  });

  it("does not trust a row for a different patient or a different medication", async () => {
    const wrongPatient = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null }, ok([med({ patient_id: "99999999-9999-4999-8999-999999999999" })]));
    expect(await loadPrescriptionForClinician(wrongPatient.client, ACTOR, PATIENT, MED)).toEqual({ status: "not_found" });
    const wrongMed = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null }, ok([med({ id: "88888888-8888-4888-8888-888888888888" })]));
    expect(await loadPrescriptionForClinician(wrongMed.client, ACTOR, PATIENT, MED)).toEqual({ status: "not_found" });
  });

  it("applies the same issuing rules: a superseded prescription is refused", async () => {
    const { client, audit } = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null }, ok([med({ superseded_at: "2026-09-30T00:00:00Z", is_active: false })]));
    expect(await loadPrescriptionForClinician(client, ACTOR, PATIENT, MED)).toMatchObject({ status: "refused", reason: "superseded" });
    expect(audit).toHaveLength(0);
  });

  it("surfaces a read error rather than reading it as none", async () => {
    const { client } = fakeClient({ meds: [], patient: goodPatient, staff: goodStaff, auditError: null }, { data: null, error: { message: "boom" } });
    expect((await loadPrescriptionForClinician(client, ACTOR, PATIENT, MED)).status).toBe("error");
  });
});
