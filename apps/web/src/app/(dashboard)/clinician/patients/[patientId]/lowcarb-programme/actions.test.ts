/**
 * S50b: the clinician's server actions for the low-carbohydrate programme. Input is validated with Zod, every action runs one database function on
 * the clinician's own client, refusals become plain words, and nothing here can sign, apply or message a medicine change (INV-02, INV-07).
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptLowCarbSupervision, checkLowCarbEligibility, completeLowCarbReview, offerLowCarb, pauseLowCarb, resumeLowCarb, stopLowCarb } from "./actions";

const PATIENT = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const ENROLMENT = "7a1c2e3d-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe("offerLowCarb", () => {
  it("needs the admission confirmation and never reaches the database without it", async () => {
    const r = await offerLowCarb(undefined, form({ patientId: PATIENT }));
    expect(r?.error).toMatch(/no recent severe low sugar/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the confirmation, the supervision flag and the note to the database function", async () => {
    rpc.mockResolvedValue({ data: ENROLMENT, error: null });
    const r = await offerLowCarb(undefined, form({ patientId: PATIENT, noRecentAdmission: "on", supervisionAccepted: "on", supervisionNote: "Weekly review by me" }));
    expect(r).toEqual({ message: "Offered. The patient decides whether to start." });
    expect(rpc).toHaveBeenCalledWith("offer_lowcarb_programme", {
      p_patient: PATIENT,
      p_no_recent_admission: true,
      p_supervision_accepted: true,
      p_supervision_note: "Weekly review by me",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/clinician/patients/${PATIENT}`);
  });

  it("refuses a bad patient id without calling the database", async () => {
    const r = await offerLowCarb(undefined, form({ patientId: "nope", noRecentAdmission: "on" }));
    expect(r?.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains a refusal and lists the reasons the database gave, in words", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "This person cannot be offered the programme now (not_eligible)", details: "health_condition,under_age" } });
    const r = await offerLowCarb(undefined, form({ patientId: PATIENT, noRecentAdmission: "on" }));
    expect(r?.error).toBe("This person cannot be offered the programme now (not_eligible)");
    expect(r?.lines).toEqual(["A health condition on record rules this out.", "Under 18."]);
  });

  it("maps not-allowed, a duplicate and the closed guard to plain sentences, and anything else to a generic one", async () => {
    for (const [code, message, expected] of [
      ["42501", "x", /Only a prescriber tied to this patient/],
      ["23505", "x", /already has an open programme/],
      ["55000", "This programme is not open yet", /not open yet/],
      ["XX000", "internal detail", /Something went wrong/],
    ] as const) {
      rpc.mockResolvedValue({ data: null, error: { code, message } });
      const r = await offerLowCarb(undefined, form({ patientId: PATIENT, noRecentAdmission: "on" }));
      expect(r?.error).toMatch(expected);
      expect(r?.error).not.toMatch(/internal detail/);
    }
  });
});

describe("checkLowCarbEligibility", () => {
  it("shows plain words, never a code", async () => {
    rpc.mockResolvedValue({ data: { decision: "not_eligible", reasons: ["pregnancy_or_postnatal", "condition_kidney_disease"] }, error: null });
    const r = await checkLowCarbEligibility(undefined, form({ patientId: PATIENT }));
    expect(r?.message).toBe("This person does not meet the programme screen.");
    expect(r?.lines).toEqual(["Pregnancy or the year after a birth.", "Kidney disease on record."]);
  });

  it.each([
    ["eligible", "This person meets the programme screen today."],
    ["needs_supervision", "A doctor must accept supervision of the medicines first."],
    ["not_now", "Not today."],
  ])("%s", async (decision, message) => {
    rpc.mockResolvedValue({ data: { decision, reasons: ["none"] }, error: null });
    expect((await checkLowCarbEligibility(undefined, form({ patientId: PATIENT })))?.message).toBe(message);
  });

  it("an unreadable answer is an error, never eligible", async () => {
    rpc.mockResolvedValue({ data: { nonsense: true }, error: null });
    expect((await checkLowCarbEligibility(undefined, form({ patientId: PATIENT })))?.error).toBeTruthy();
  });
});

describe("pause, resume, stop", () => {
  it.each([
    ["pause_lowcarb_programme", pauseLowCarb, "Paused."],
    ["resume_lowcarb_programme", resumeLowCarb, "Resumed."],
    ["stop_lowcarb_programme", stopLowCarb, "Stopped."],
  ] as const)("%s runs only its own function", async (fn, action, message) => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(action(undefined, form({ patientId: PATIENT, enrolmentId: ENROLMENT }))).resolves.toEqual({ message });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(fn, { p_enrolment: ENROLMENT });
  });

  it("a refusal changes nothing and says so", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "This person cannot restart the programme now (not_now)" } });
    const r = await resumeLowCarb(undefined, form({ patientId: PATIENT, enrolmentId: ENROLMENT }));
    expect(r?.error).toBe("This person cannot restart the programme now (not_now)");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses bad ids without calling the database", async () => {
    await expect(pauseLowCarb(undefined, form({ patientId: PATIENT, enrolmentId: "x" }))).resolves.toEqual({ error: "Check the form." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("completeLowCarbReview", () => {
  it("needs a real note", async () => {
    const r = await completeLowCarbReview(undefined, form({ patientId: PATIENT, enrolmentId: ENROLMENT, note: "ok" }));
    expect(r?.error).toMatch(/what you decided/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("records it through the database function", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(completeLowCarbReview(undefined, form({ patientId: PATIENT, enrolmentId: ENROLMENT, note: "Reviewed, no change today" }))).resolves.toEqual({ message: "Medicine review recorded." });
    expect(rpc).toHaveBeenCalledWith("complete_lowcarb_medicine_review", { p_enrolment: ENROLMENT, p_note: "Reviewed, no change today" });
  });
});

describe("acceptLowCarbSupervision", () => {
  it("needs a real note and never reaches the database without one", async () => {
    const r = await acceptLowCarbSupervision(undefined, form({ patientId: PATIENT, enrolmentId: ENROLMENT, note: "ok" }));
    expect(r?.error).toMatch(/how you will supervise/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("records it through the one database function", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await acceptLowCarbSupervision(undefined, form({ patientId: PATIENT, enrolmentId: ENROLMENT, note: "I will review the insulin weekly" }));
    expect(r?.message).toMatch(/Supervision of the current medicines is recorded/);
    expect(rpc).toHaveBeenCalledWith("accept_lowcarb_supervision", { p_enrolment: ENROLMENT, p_note: "I will review the insulin weekly" });
  });
});

describe("INV-02 and INV-01: this folder can propose nothing it can also sign, and calls no model", () => {
  const dir = join(process.cwd(), "src", "app", "(dashboard)", "clinician", "patients", "[patientId]", "lowcarb-programme");
  const libDir = join(process.cwd(), "src", "lib", "lowcarb");
  const sources = [join(dir, "actions.ts"), join(dir, "lowcarb-controls.tsx"), join(dir, "lowcarb-programme-panel.tsx"), join(libDir, "medicine-review.ts"), join(libDir, "programme.ts")].map((f) =>
    readFileSync(f, "utf8"),
  );
  it("never calls the signing, confirming or prescribing functions", () => {
    for (const s of sources) {
      expect(s).not.toMatch(/sign_care_plan_change|confirm_care_plan_change|prescribe_medication|amend_medication|confirm_medication_refill/);
    }
  });
  it("never imports a language model or the AI governance layer", () => {
    for (const s of sources) {
      expect(s).not.toMatch(/anthropic|openai|runGovernedAi|ai-governance|langgraph/i);
    }
  });
  it("only ever writes through the allowed database functions", () => {
    const allowed = new Set([
      "lowcarb_eligibility", "offer_lowcarb_programme", "pause_lowcarb_programme", "resume_lowcarb_programme", "stop_lowcarb_programme",
      "complete_lowcarb_medicine_review", "accept_lowcarb_supervision", "lowcarb_programme_for_patient", "get_approved_protocol", "propose_care_plan_change",
    ]);
    for (const s of sources) {
      for (const m of s.matchAll(/\.rpc\(\s*(?:"([a-z_]+)"|fn\b)/g)) if (m[1]) expect(allowed.has(m[1])).toBe(true);
    }
  });
});
