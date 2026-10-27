import { flaggedReadingMessage, patientHasDoctorReview } from "./doctor-review-claim";

type Result = { data: unknown; error: unknown };
const client = (rpc: (name: string, args: unknown) => Promise<Result>) => ({ rpc }) as unknown as Parameters<typeof patientHasDoctorReview>[0];

describe("patientHasDoctorReview", () => {
  it("is true only when the flag resolves to true", async () => {
    const rpc = jest.fn(async (_n: string, _a: unknown): Promise<Result> => ({ data: true, error: null }));
    expect(await patientHasDoctorReview(client(rpc), "p1")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("patient_has_feature_access", { p_patient_id: "p1", p_feature: "vitals_red_flag_doctor_escalation" });
  });
  it("is false for Free, for an error and for a throw (no claim is made)", async () => {
    expect(await patientHasDoctorReview(client(async () => ({ data: false, error: null })), "p")).toBe(false);
    expect(await patientHasDoctorReview(client(async () => ({ data: null, error: { code: "42501" } })), "p")).toBe(false);
    expect(
      await patientHasDoctorReview(
        client(async () => {
          throw new Error("x");
        }),
        "p",
      ),
    ).toBe(false);
  });
});

describe("flaggedReadingMessage", () => {
  it("tells a Member the care team was notified", () => {
    expect(flaggedReadingMessage(true)).toMatch(/care team has been notified/);
  });
  it("tells a Free patient only that the entry is saved", () => {
    expect(flaggedReadingMessage(false)).toBe("Your entry is saved.");
    expect(flaggedReadingMessage(false)).not.toMatch(/notified|doctor/i);
  });
});
