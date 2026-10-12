/** @jest-environment jsdom */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const rpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (n: string, a: Record<string, unknown>) => rpc(n, a) }) }));

import { usePharmacistRecordDispense } from "./pharmacist";

/**
 * OQ-276: the order screen's record-a-supply call. The database refuses a controlled medicine with the outcome text (so the refusal is audited, not
 * raised); the hook must hand that outcome to the page instead of treating the call as a success, and must no longer send the old
 * "enhanced verification" tick-box arguments.
 */
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const input = { orderId: "11111111-1111-1111-1111-111111111111", drugName: "Tramadol 50mg", quantity: "10", dispensedOn: "2026-10-08" };

describe("usePharmacistRecordDispense (OQ-276)", () => {
  beforeEach(() => { rpc.mockReset(); });

  it("returns controlled_medicine when the database refuses a controlled medicine", async () => {
    rpc.mockResolvedValue({ data: "controlled_medicine", error: null });
    const { result } = renderHook(() => usePharmacistRecordDispense(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    await waitFor(() => expect(result.current.data).toBe("controlled_medicine"));
  });

  it("returns recorded for an ordinary medicine, and also for the pre-change database that answers nothing", async () => {
    for (const data of ["recorded", null]) {
      rpc.mockResolvedValue({ data, error: null });
      const { result } = renderHook(() => usePharmacistRecordDispense(), { wrapper });
      await act(async () => { await result.current.mutateAsync({ ...input, drugName: "Amlodipine 5mg" }); });
      await waitFor(() => expect(result.current.data).toBe("recorded"));
    }
  });

  it("never sends the retired controlled-tier or enhanced-verification arguments", async () => {
    rpc.mockResolvedValue({ data: "recorded", error: null });
    const { result } = renderHook(() => usePharmacistRecordDispense(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    const args = rpc.mock.calls[0][1];
    expect(rpc.mock.calls[0][0]).toBe("pharmacist_record_dispense");
    expect(args).not.toHaveProperty("p_controlled_tier");
    expect(args).not.toHaveProperty("p_enhanced_verification_confirmed");
  });

  it("still throws a real database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Order not found for this pharmacy" } });
    const { result } = renderHook(() => usePharmacistRecordDispense(), { wrapper });
    await expect(act(async () => { await result.current.mutateAsync(input); })).rejects.toBeTruthy();
  });
});
