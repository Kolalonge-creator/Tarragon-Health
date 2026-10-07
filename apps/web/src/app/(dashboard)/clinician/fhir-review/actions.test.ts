/**
 * Data Architecture Gaps Build Plan §1 fast-follow (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md):
 * the FHIR review worklist's "modified" status path — confirming a proposed
 * resource with a clinician-edited payload instead of the parser's raw
 * output. Proves, against the real modifyFhirProposedResource server
 * action:
 *   - each edited field is coerced per `fieldKindOf(key)` (editable-field-
 *     config.ts) — number/boolean(checkbox)/enum(select)/text — never a
 *     client-supplied type hint;
 *   - a "readonly" field (vital_type, vaccination_catalog_id) can never be
 *     overwritten even if a tampered submission includes one;
 *   - an enum field (severity, glucose_context) only ever accepts a real
 *     value from that field's own enum — an invalid one falls back to the
 *     original rather than reaching the DB's own ::allergy_severity/
 *     ::glucose_context cast;
 *   - a boolean field reads real checkbox presence, not a case-sensitive
 *     "does the text say true" string comparison — a /code-review finding
 *     on an earlier version of this file (typing "True" silently wrote
 *     `false` with no error);
 *   - a numeric field rejects Infinity/-Infinity, not just NaN — another
 *     /code-review finding (Number("Infinity") is not NaN, and Infinity
 *     silently becomes `null` over the wire);
 *   - a field the caller doesn't submit (`edited.<key>` absent) keeps its
 *     original value rather than being dropped or nulled;
 *   - a key that doesn't already exist on normalized_payload cannot be
 *     smuggled into confirmed_payload — only keys the parser actually
 *     produced are ever written;
 *   - a non-clinical-tier caller (no matching active clinical_staff row) is
 *     refused before any write happens — the same app-layer gate
 *     confirmFhirProposedResource already has.
 */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const proposedResourcesSelect = jest.fn();
const proposedResourcesUpdate = jest.fn();
const clinicalStaffSelect = jest.fn();
let currentUser: { id: string } | null = { id: "doctor-1" };

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: jest.fn(async () => currentUser),
  createClient: jest.fn(async () => ({
    from: (table: string) => {
      if (table === "fhir_import_proposed_resources") {
        return {
          select: proposedResourcesSelect,
          update: proposedResourcesUpdate,
        };
      }
      if (table === "clinical_staff") {
        return { select: clinicalStaffSelect };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { modifyFhirProposedResource } from "./actions";

const OBSERVATION_PAYLOAD = {
  vital_type: "glucose",
  taken_at: "2026-09-01T10:00:00Z",
  glucose_mmol_l: 5.6,
  glucose_context: "random",
};

const MEDICATION_PAYLOAD = { drug_name: "Metformin", dose: null, frequency: null, is_active: true };

const ALLERGY_PAYLOAD = { allergen: "Penicillin", reaction: "Rash", severity: "moderate", noted_at: "2020-01-01" };

function stubReviewOf(normalizedPayload: Record<string, unknown>, opts?: { staffTier?: string | null }) {
  let selectCallCount = 0;
  proposedResourcesSelect.mockImplementation(() => {
    selectCallCount += 1;
    const isFirstCall = selectCallCount === 1;
    return {
      eq: () => ({
        maybeSingle: async () =>
          isFirstCall ? { data: { organisation_id: "org-1" } } : { data: { normalized_payload: normalizedPayload } },
      }),
    };
  });
  clinicalStaffSelect.mockReturnValue({
    eq: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: opts?.staffTier === undefined ? { doctor_tier: "medical_officer" } : opts.staffTier ? { doctor_tier: opts.staffTier } : null,
          }),
        }),
      }),
    }),
  });
  proposedResourcesUpdate.mockImplementation(() => ({
    eq: async () => ({ error: null }),
  }));
}

const VALID_ID = "11111111-1111-1111-8111-111111111111";

function formDataFrom(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("modifyFhirProposedResource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = { id: "doctor-1" };
  });

  it("coerces an edited numeric field back to a number, not a string", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID, "edited.glucose_mmol_l": "6.2" });

    const result = await modifyFhirProposedResource(undefined, fd);

    expect(result?.error).toBeUndefined();
    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.status).toBe("modified");
    expect(patch.confirmed_payload.glucose_mmol_l).toBe(6.2);
    expect(typeof patch.confirmed_payload.glucose_mmol_l).toBe("number");
  });

  it("rejects Infinity/-Infinity from a numeric field and falls back to the original value", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID, "edited.glucose_mmol_l": "Infinity" });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.glucose_mmol_l).toBe(OBSERVATION_PAYLOAD.glucose_mmol_l);
    expect(Number.isFinite(patch.confirmed_payload.glucose_mmol_l)).toBe(true);
  });

  it("never overwrites a readonly field (vital_type) even if a tampered submission includes one", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID, "edited.vital_type": "blood_pressure", "edited.glucose_mmol_l": "6.2" });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.vital_type).toBe("glucose");
  });

  it("accepts a valid enum value for glucose_context via the select field", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID, "edited.glucose_context": "post_meal" });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.glucose_context).toBe("post_meal");
  });

  it("falls back to the original value for an enum field given an invalid submission", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID, "edited.glucose_context": "not-a-real-value" });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.glucose_context).toBe("random");
  });

  it("validates severity against its own enum for an AllergyIntolerance payload", async () => {
    stubReviewOf(ALLERGY_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID, "edited.severity": "severe" });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.severity).toBe("severe");
    expect(patch.confirmed_payload.allergen).toBe("Penicillin");
    expect(patch.confirmed_payload.noted_at).toBe("2020-01-01");
  });

  it("keeps a field's original value when the caller doesn't submit it", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID, "edited.glucose_mmol_l": "7.1" });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.glucose_context).toBe("random");
    expect(patch.confirmed_payload.taken_at).toBe(OBSERVATION_PAYLOAD.taken_at);
  });

  it("ignores a key that doesn't already exist on normalized_payload", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD);
    const fd = formDataFrom({
      id: VALID_ID,
      "edited.glucose_mmol_l": "6.0",
      "edited.injected_extra_field": "should not appear",
    });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(Object.keys(patch.confirmed_payload).sort()).toEqual(Object.keys(OBSERVATION_PAYLOAD).sort());
    expect(patch.confirmed_payload.injected_extra_field).toBeUndefined();
  });

  it("reads a checked boolean field from checkbox presence, not string comparison", async () => {
    stubReviewOf(MEDICATION_PAYLOAD);
    // A checked HTML checkbox submits its value (default "on") when present in the FormData at all.
    const fd = formDataFrom({ id: VALID_ID, "edited.is_active": "on" });

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.is_active).toBe(true);
  });

  it("reads an unchecked boolean field as false, since an unchecked checkbox is absent from the form", async () => {
    stubReviewOf(MEDICATION_PAYLOAD);
    const fd = formDataFrom({ id: VALID_ID }); // no "edited.is_active" key at all — unchecked

    await modifyFhirProposedResource(undefined, fd);

    const [patch] = proposedResourcesUpdate.mock.calls[0];
    expect(patch.confirmed_payload.is_active).toBe(false);
  });

  it("refuses a caller with no matching active clinical_staff row, and writes nothing", async () => {
    stubReviewOf(OBSERVATION_PAYLOAD, { staffTier: null });

    const fd = formDataFrom({ id: VALID_ID, "edited.glucose_mmol_l": "6.2" });
    const result = await modifyFhirProposedResource(undefined, fd);

    expect(result?.error).toMatch(/Care Coordinator/);
    expect(proposedResourcesUpdate).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller before touching the database", async () => {
    currentUser = null;
    const fd = formDataFrom({ id: VALID_ID, "edited.glucose_mmol_l": "6.2" });

    const result = await modifyFhirProposedResource(undefined, fd);

    expect(result?.error).toBe("Not signed in");
    expect(proposedResourcesSelect).not.toHaveBeenCalled();
  });

  it("rejects a malformed id without touching the database", async () => {
    const fd = formDataFrom({ id: "not-a-uuid" });
    const result = await modifyFhirProposedResource(undefined, fd);
    expect(result?.error).toBe("Invalid request");
    expect(proposedResourcesSelect).not.toHaveBeenCalled();
  });
});
