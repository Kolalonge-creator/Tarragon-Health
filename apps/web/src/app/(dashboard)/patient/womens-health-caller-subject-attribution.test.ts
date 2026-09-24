/**
 * setLastMenstrualPeriod, recordDelivery and logPostnatalCheckin used to
 * write patient_id: user.id (the caller) instead of the resolved subject —
 * so a supporter acting for someone they support would silently land their
 * submission on their OWN patient_pregnancy/postnatal record rather than
 * the person they were actually filling the form out for. patient_pregnancy
 * and postnatal_profiles/postnatal_checkins deliberately have no caregiver
 * RLS path at all (see the "no caregiver access, matching patient_pregnancy"
 * comments in 20260829121135_pregnancy_antenatal_extension.sql and
 * 20260829121137_postnatal_programme.sql), so the fix is to refuse the
 * write with a clear error when acting for someone else, via the shared
 * assertNotActingFor() helper (checked BEFORE resolving the subject/org, so
 * the refusal fires even when the beneficiary's own profile is incomplete —
 * see the second describe block below) — rather than let it land on the
 * wrong identity.
 *
 * reportPregnancyDangerSymptoms had the same caller-vs-subject bug, but
 * emergency_events DOES have a working acting-for INSERT policy
 * (emergency_events_insert_acting), so its fix is the opposite: the write
 * must now succeed, attributed to the actual subject, not the caller.
 */

const authGetUser = jest.fn();
const profilesSingle = jest.fn();
const pregnancyUpsert = jest.fn();
const postnatalProfilesInsert = jest.fn();
const postnatalCheckinsInsert = jest.fn();
const emergencyEventsInsert = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: authGetUser },
    from: (table: string) => {
      switch (table) {
        case "profiles":
          return { select: () => ({ eq: () => ({ single: profilesSingle }) }) };
        case "patient_pregnancy":
          return { upsert: pregnancyUpsert };
        case "postnatal_profiles":
          return { insert: postnatalProfilesInsert };
        case "postnatal_checkins":
          return { insert: postnatalCheckinsInsert };
        case "emergency_events":
          return { insert: emergencyEventsInsert };
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  }),
}));

const resolveSubjectId = jest.fn();
const assertNotActingFor = jest.fn();
jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: (ownProfileId: string) => resolveSubjectId(ownProfileId),
  assertNotActingFor: (message: string) => assertNotActingFor(message),
}));

import {
  setLastMenstrualPeriod,
  recordDelivery,
  logPostnatalCheckin,
  reportPregnancyDangerSymptoms,
} from "./womens-health-actions";

const CALLER_ID = "11111111-1111-4111-8111-111111111111";
const BENEFICIARY_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const NO_CAREGIVER_ERROR =
  "Pregnancy and postnatal records can only be managed on your own account, not for someone you support.";

function lmpFormData() {
  const fd = new FormData();
  fd.set("last_menstrual_period_date", "2026-06-01");
  return fd;
}

function deliveryFormData() {
  const fd = new FormData();
  fd.set("delivery_date", "2026-09-01");
  fd.set("delivery_mode", "vaginal");
  return fd;
}

function checkinFormData() {
  const fd = new FormData();
  fd.set("checkin_window", "week_1");
  return fd;
}

function dangerSignsFormData() {
  const fd = new FormData();
  fd.append("signs", "severe_abdominal_pain");
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  authGetUser.mockResolvedValue({ data: { user: { id: CALLER_ID } } });
  profilesSingle.mockResolvedValue({ data: { organisation_id: ORG_ID } });
  pregnancyUpsert.mockResolvedValue({ error: null });
  postnatalProfilesInsert.mockResolvedValue({ error: null });
  postnatalCheckinsInsert.mockResolvedValue({ error: null });
  emergencyEventsInsert.mockResolvedValue({ error: null });
});

describe("womens-health-actions — caller vs subject attribution", () => {
  describe("acting for a beneficiary (no caregiver path for pregnancy/postnatal)", () => {
    beforeEach(() => {
      resolveSubjectId.mockResolvedValue(BENEFICIARY_ID);
      assertNotActingFor.mockResolvedValue({ error: NO_CAREGIVER_ERROR });
    });

    it("setLastMenstrualPeriod refuses the write instead of landing it on the caller's own record", async () => {
      const result = await setLastMenstrualPeriod(undefined, lmpFormData());

      expect(result?.error).toBe(NO_CAREGIVER_ERROR);
      expect(pregnancyUpsert).not.toHaveBeenCalled();
    });

    it("recordDelivery refuses the write instead of landing it on the caller's own record", async () => {
      const result = await recordDelivery(undefined, deliveryFormData());

      expect(result?.error).toBe(NO_CAREGIVER_ERROR);
      expect(pregnancyUpsert).not.toHaveBeenCalled();
      expect(postnatalProfilesInsert).not.toHaveBeenCalled();
    });

    it("logPostnatalCheckin refuses the write instead of landing it on the caller's own record", async () => {
      const result = await logPostnatalCheckin("postnatal-profile-1", undefined, checkinFormData());

      expect(result?.error).toBe(NO_CAREGIVER_ERROR);
      expect(postnatalCheckinsInsert).not.toHaveBeenCalled();
    });

    it("refuses before looking up the organisation, so an incomplete beneficiary profile doesn't produce a misleading error", async () => {
      // Regression case: the guard used to run AFTER the organisation lookup
      // (keyed on the resolved subject), so a beneficiary with no
      // organisation_id yet made a blocked caregiver see "No organisation on
      // file" instead of the real "can't manage on someone else's behalf"
      // refusal. Proving profilesSingle is never even called shows the
      // guard now runs first.
      profilesSingle.mockResolvedValue({ data: null });

      const result = await setLastMenstrualPeriod(undefined, lmpFormData());

      expect(result?.error).toBe(NO_CAREGIVER_ERROR);
      expect(profilesSingle).not.toHaveBeenCalled();
    });

    it("reportPregnancyDangerSymptoms attributes the emergency to the beneficiary, not the caller", async () => {
      const result = await reportPregnancyDangerSymptoms(undefined, dangerSignsFormData());

      expect(result?.error).toBeUndefined();
      expect(emergencyEventsInsert).toHaveBeenCalledTimes(1);
      expect(emergencyEventsInsert.mock.calls[0][0]).toMatchObject({
        patient_id: BENEFICIARY_ID,
        organisation_id: ORG_ID,
      });
    });
  });

  describe("acting for nobody (self)", () => {
    beforeEach(() => {
      resolveSubjectId.mockResolvedValue(CALLER_ID);
      assertNotActingFor.mockResolvedValue(null);
    });

    it("setLastMenstrualPeriod still writes under the caller's own id", async () => {
      const result = await setLastMenstrualPeriod(undefined, lmpFormData());

      expect(result?.error).toBeUndefined();
      expect(pregnancyUpsert).toHaveBeenCalledTimes(1);
      expect(pregnancyUpsert.mock.calls[0][0]).toMatchObject({ patient_id: CALLER_ID });
    });

    it("recordDelivery still writes under the caller's own id", async () => {
      const result = await recordDelivery(undefined, deliveryFormData());

      expect(result?.error).toBeUndefined();
      expect(pregnancyUpsert.mock.calls[0][0]).toMatchObject({ patient_id: CALLER_ID });
      expect(postnatalProfilesInsert.mock.calls[0][0]).toMatchObject({ patient_id: CALLER_ID });
    });

    it("logPostnatalCheckin still writes under the caller's own id", async () => {
      const result = await logPostnatalCheckin("postnatal-profile-1", undefined, checkinFormData());

      expect(result?.error).toBeUndefined();
      expect(postnatalCheckinsInsert.mock.calls[0][0]).toMatchObject({ patient_id: CALLER_ID });
    });

    it("reportPregnancyDangerSymptoms still writes under the caller's own id", async () => {
      const result = await reportPregnancyDangerSymptoms(undefined, dangerSignsFormData());

      expect(result?.error).toBeUndefined();
      expect(emergencyEventsInsert.mock.calls[0][0]).toMatchObject({ patient_id: CALLER_ID });
    });
  });
});
