/**
 * S59c review fix: acting for someone else must never raise the danger event. auth.uid() would be the carer, so the emergency event and the
 * Priority 1 page would land on the wrong person. The action refuses before any database call; the on-screen guidance is untouched.
 */
const rpc = jest.fn(async () => ({ data: { recorded: true, doctor_alerted: true }, error: null }));
const getActingFor = jest.fn();

jest.mock("@/lib/acting/acting-for", () => ({ getActingFor: () => getActingFor() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "carer-1" } } }) },
    rpc: (...a: unknown[]) => rpc(...(a as [])),
  }),
}));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/symptom-checkback/answer", () => ({ answerCheckback: jest.fn() }));

import { recordDescribeDangerAction } from "./actions";

const INPUT = { session: "5b0d0c1e-3c1a-4a43-8d57-3f3d0e9f8a11", category: "self_harm" };

beforeEach(() => {
  rpc.mockClear();
  getActingFor.mockReset();
});

describe("recordDescribeDangerAction", () => {
  it("records nothing and promises nothing while acting for someone else", async () => {
    getActingFor.mockResolvedValue({ profileId: "patient-9", fullName: "Someone" });
    expect(await recordDescribeDangerAction(INPUT)).toEqual({ recorded: false, doctorAlerted: false, reason: "acting_for" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records for the person themselves", async () => {
    getActingFor.mockResolvedValue(null);
    expect(await recordDescribeDangerAction(INPUT)).toEqual({ recorded: true, doctorAlerted: true });
    expect(rpc).toHaveBeenCalledWith("record_describe_danger", { p_session: INPUT.session, p_category: "self_harm" });
  });
});
