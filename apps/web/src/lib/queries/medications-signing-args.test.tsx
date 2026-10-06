/** @jest-environment jsdom */
/**
 * S24: prescribe_medication and amend_medication take two trailing arguments. The hooks must send the signer's answers, default the
 * allergy confirmation to false (never ticked on the signer's behalf), and send nothing for an empty reason.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

const rpc = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
jest.mock("@/lib/audit/log-denied-action", () => ({ handleIfPermissionDenied: jest.fn() }));
jest.mock("@/lib/clinical/medications-audited", () => ({ readPatientMedicationsOrThrow: jest.fn() }));

import { useAddMedication, useAmendMedication } from "./medications";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}

const BASE = { drug_name: "Amlodipine", schedule_times: [], quantity: "30 tablets", duration_days: 30 };

beforeEach(() => rpc.mockReset().mockResolvedValue({ data: "id", error: null }));

describe("signing arguments", () => {
  it("prescribe sends allergies_confirmed false and no reason by default", async () => {
    const { result } = renderHook(() => useAddMedication(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...BASE, patientId: "p1", source: "clinician" });
    });
    expect(rpc).toHaveBeenCalledWith("prescribe_medication", expect.objectContaining({ p_allergies_confirmed: false, p_safety_override_reason: undefined }));
  });

  it("prescribe sends the signer's answers, trimmed", async () => {
    const { result } = renderHook(() => useAddMedication(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...BASE, patientId: "p1", source: "clinician", safety: { allergiesConfirmed: true, overrideReason: "  Tolerated before " } });
    });
    expect(rpc).toHaveBeenCalledWith("prescribe_medication", expect.objectContaining({ p_allergies_confirmed: true, p_safety_override_reason: "Tolerated before" }));
  });

  it("amend sends the same two arguments", async () => {
    const { result } = renderHook(() => useAmendMedication(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        medicationId: "m1",
        patientId: "p1",
        organisationId: "o1",
        input: { amendment_reason: "Dose increased", schedule_times: [] },
        safety: { allergiesConfirmed: true, overrideReason: "" },
      });
    });
    expect(rpc).toHaveBeenCalledWith("amend_medication", expect.objectContaining({ p_allergies_confirmed: true, p_safety_override_reason: undefined }));
  });

  it("a safety stop reaches the caller as the original error (so the form can parse it)", async () => {
    const stop = { code: "P0001", details: "SAFETY_FINDINGS", hint: "[]", message: "m" };
    rpc.mockResolvedValue({ data: null, error: stop });
    const { result } = renderHook(() => useAddMedication(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ ...BASE, patientId: "p1", source: "clinician" })).rejects.toBe(stop);
    });
  });
});
