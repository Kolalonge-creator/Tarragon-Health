import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// F1 (INV-14): the symptom checker fails closed. With the go-live guard off, errored or unanswered, the picker is empty
// and the step action answers "unavailable" WITHOUT reading the protocol or touching the service-role insert.

type RpcResult = Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => RpcResult>();
const insert = jest.fn();
const getActiveTriageProtocolConfigActual = jest.fn(async () => ({
  config: { pathways: [{ key: "headache", label: "Headache" }] },
  protocolVersion: 1,
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "o1" } }) }) }) }),
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: () => ({ insert }) }),
}));
jest.mock("@/lib/acting/acting-for", () => ({ resolveSubjectId: async (id: string) => id }));
jest.mock("@/lib/symptom-triage/protocol", () => {
  const actual = jest.requireActual("@/lib/symptom-triage/protocol") as Record<string, unknown>;
  return {
    ...actual,
    getActiveTriageProtocolConfig: getActiveTriageProtocolConfigActual,
    getActivePathway: jest.fn(async () => null),
  };
});

import { listAvailablePresentingComplaints, stepSymptomTriage } from "./symptom-triage-actions";

const input = {
  capture: {
    presentingComplaintKey: "headache",
    onset: "sudden",
    severity: 3,
    associatedSymptoms: [],
    triggers: [],
    relevantHistory: [],
    measurements: {},
  },
  answers: {},
  questionLog: [],
} as unknown as Parameters<typeof stepSymptomTriage>[0];

beforeEach(() => {
  rpc.mockReset();
  insert.mockReset();
  getActiveTriageProtocolConfigActual.mockClear();
});

describe("symptom checker go-live guard (server side)", () => {
  it("asks the symptom_checker_enabled guard, and shows no complaints while it is off", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await listAvailablePresentingComplaints()).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("go_live_guard_is_open", { p_key: "symptom_checker_enabled" });
    expect(getActiveTriageProtocolConfigActual).not.toHaveBeenCalled();
  });

  it("answers unavailable and records nothing while the guard is off", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(stepSymptomTriage(input)).resolves.toEqual({ status: "unavailable" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails closed when the guard cannot be read", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await listAvailablePresentingComplaints()).toEqual([]);
    await expect(stepSymptomTriage(input)).resolves.toEqual({ status: "unavailable" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("control: with the guard open the picker lists the signed pathways (the gate is what hid them)", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await listAvailablePresentingComplaints()).toEqual([{ key: "headache", label: "Headache", bundledCurrent: false }]);
  });
});
