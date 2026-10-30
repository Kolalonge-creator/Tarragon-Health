/** @jest-environment jsdom */
/** The reporting hooks pass an explicit row limit, so a page or pack can tell when it reached it. */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { useApprovalHistory, useFinanceAuditLog, useLedgerEntries } from "./queries";

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const callOf = (name: string) => rpc.mock.calls.find((c) => c[0] === name)?.[1];

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: [], error: null }); });

describe("finance reporting hooks pass a row limit", () => {
  it("ledger: 200 by default, and what the caller asks for", async () => {
    const { result, rerender } = renderHook(({ limit }: { limit?: number }) => useLedgerEntries({ from: "2026-01-01", to: "2026-01-31", limit }), { wrapper: wrap(), initialProps: {} });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callOf("finance_ledger_entries")).toMatchObject({ p_limit: 200 });
    rpc.mockClear();
    rerender({ limit: 5000 });
    await waitFor(() => expect(callOf("finance_ledger_entries")).toBeDefined());
    expect(callOf("finance_ledger_entries")).toMatchObject({ p_limit: 5000 });
  });
  it("audit log: 200 by default, and what the caller asks for", async () => {
    const { result } = renderHook(() => useFinanceAuditLog({ from: "a", to: "b", limit: 5000 }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callOf("finance_audit_log")).toMatchObject({ p_limit: 5000 });
    rpc.mockClear();
    const second = renderHook(() => useFinanceAuditLog({ from: "a", to: "c" }), { wrapper: wrap() });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(callOf("finance_audit_log")).toMatchObject({ p_limit: 200 });
  });
  it("approval history: 100 by default, and what the caller asks for", async () => {
    const a = renderHook(() => useApprovalHistory(), { wrapper: wrap() });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    expect(callOf("finance_approval_history")).toEqual({ p_limit: 100 });
    rpc.mockClear();
    const b = renderHook(() => useApprovalHistory(1000), { wrapper: wrap() });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(callOf("finance_approval_history")).toEqual({ p_limit: 1000 });
  });
});
