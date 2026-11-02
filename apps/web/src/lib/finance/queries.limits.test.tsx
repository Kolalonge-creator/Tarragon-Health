/** @jest-environment jsdom */
/** The reporting hooks pass an explicit row limit, so a page or pack can tell when it reached it. */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { readAllPages, useAllFinanceAuditLog, useAllLedgerEntries, useApprovalHistory, useFinanceAuditLog, useLedgerEntries } from "./queries";

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

describe("the printed pack reads every page", () => {
  const entry = (id: string) => ({ id, entry_no: 1, entry_date: "2026-10-01", period_month: "2026-10", source: "manual", memo: null, is_reversed: false, reversal_of: null, currency: "NGN", lines: [] });

  it("readAllPages keeps asking until a short page, and holds each row once", async () => {
    const pages = [[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }], [{ id: "d" }]];
    const read = jest.fn(async (offset: number) => pages[offset / 2] ?? []);
    await expect(readAllPages(read, 100, 2)).resolves.toEqual([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    expect(read.mock.calls.map((c) => c[0])).toEqual([0, 2, 4]);
  });

  it("readAllPages stops at the ceiling and never returns more than it", async () => {
    const read = jest.fn(async (offset: number) => [{ id: `r${offset}` }, { id: `r${offset + 1}` }]);
    const rows = await readAllPages(read, 5, 2);
    expect(rows).toHaveLength(5);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("readAllPages fails as a whole when one page fails, so a partial list never passes as complete", async () => {
    const read = jest.fn(async (offset: number) => {
      if (offset === 2) throw new Error("boom");
      return [{ id: "a" }, { id: "b" }];
    });
    await expect(readAllPages(read, 100, 2)).rejects.toThrow("boom");
  });

  it("the ledger hook pages with p_limit 1000 and an advancing p_offset", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => entry(`e${i}`));
    rpc.mockResolvedValueOnce({ data: full, error: null }).mockResolvedValueOnce({ data: [entry("last")], error: null });
    const { result } = renderHook(() => useAllLedgerEntries({ from: "2026-01-01", to: "2026-01-31" }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1001);
    expect(rpc.mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ p_limit: 1000, p_offset: 0 }),
      expect.objectContaining({ p_limit: 1000, p_offset: 1000 }),
    ]);
  });

  it("the audit log hook pages the same way", async () => {
    const row = (id: string) => ({ id, created_at: "2026-10-01T10:00:00Z", actor_name: "Ada", action: "finance.post", entity_type: null, entity_id: null, event: {} });
    rpc.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => row(`l${i}`)), error: null }).mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useAllFinanceAuditLog({ from: "a", to: "b" }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1000);
    expect(rpc.mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ p_limit: 1000, p_offset: 0 }),
      expect.objectContaining({ p_limit: 1000, p_offset: 1000 }),
    ]);
  });
});
