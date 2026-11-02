/** @jest-environment jsdom */
/** The reporting hooks pass an explicit row limit, so a page or pack can tell when it reached it. */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { act } from "react";
import { flattenPages, readAllPages, useAllFinanceAuditLog, usePagedFinanceAuditLog, usePagedLedgerEntries, useAllLedgerEntries, useApprovalHistory } from "./queries";

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const callOf = (name: string) => rpc.mock.calls.find((c) => c[0] === name)?.[1];

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: [], error: null }); });

describe("finance reporting hooks pass a row limit", () => {
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

describe("Load more: the paged hooks", () => {
  const entry = (id: string) => ({ id, entry_no: 1, entry_date: "2026-10-01", period_month: "2026-10", source: "manual", memo: null, is_reversed: false, reversal_of: null, currency: "NGN", lines: [] });
  const log = (id: string) => ({ id, created_at: "2026-10-30T10:00:00.000Z", actor_name: "Ada", action: "finance.journal.post", entity_type: "x", entity_id: null, event: {} });
  const full = (prefix: string, mk: (id: string) => unknown, from = 0) => Array.from({ length: 200 }, (_, i) => mk(`${prefix}${from + i}`));
  const ledgerArgs = { from: "2026-01-01", to: "2026-01-31" };

  it("the first read is 200 rows from offset 0; a full page means there is more", async () => {
    rpc.mockResolvedValue({ data: full("e", entry), error: null });
    const { result } = renderHook(() => usePagedLedgerEntries(ledgerArgs), { wrapper: wrap() });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    expect(callOf("finance_ledger_entries")).toMatchObject({ p_limit: 200, p_offset: 0 });
    expect(result.current.hasMore).toBe(true);
  });
  it("loadMore asks for the next 200 from offset 200 and appends them in order", async () => {
    rpc.mockResolvedValueOnce({ data: full("e", entry), error: null }).mockResolvedValueOnce({ data: [entry("last")], error: null });
    const { result } = renderHook(() => usePagedLedgerEntries(ledgerArgs), { wrapper: wrap() });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(201));
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_limit: 200, p_offset: 200 });
    expect(result.current.rows?.[0].id).toBe("e0");
    expect(result.current.rows?.[200].id).toBe("last");
    expect(result.current.hasMore).toBe(false);
  });
  it("each further page moves the offset on by a whole page: 200, then 400", async () => {
    rpc.mockResolvedValueOnce({ data: full("a", entry), error: null })
      .mockResolvedValueOnce({ data: full("b", entry), error: null })
      .mockResolvedValueOnce({ data: [entry("c")], error: null });
    const { result } = renderHook(() => usePagedLedgerEntries(ledgerArgs), { wrapper: wrap() });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(400));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(401));
    expect(rpc.mock.calls.map((c) => c[1].p_offset)).toEqual([0, 200, 400]);
  });
  it("a short first page has no more to load", async () => {
    rpc.mockResolvedValue({ data: [entry("a"), entry("b")], error: null });
    const { result } = renderHook(() => usePagedLedgerEntries(ledgerArgs), { wrapper: wrap() });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
  });
  it("an entry posted between pages shifts the offset by one: the repeated row is held once and the list still goes on", async () => {
    const first = full("e", entry);
    const second = [first[199], ...full("n", entry, 0).slice(0, 199)];
    rpc.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: second, error: null });
    const { result } = renderHook(() => usePagedLedgerEntries(ledgerArgs), { wrapper: wrap() });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(399));
    expect(new Set(result.current.rows?.map((r) => r.id)).size).toBe(399);
    // the second page was full (200 rows from the database), so there may be a third even though 199 were new
    expect(result.current.hasMore).toBe(true);
  });
  it("a failed next page keeps the rows already read, says so, and a retry reads the same page", async () => {
    rpc.mockResolvedValueOnce({ data: full("e", entry), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: [entry("last")], error: null });
    const { result } = renderHook(() => usePagedLedgerEntries(ledgerArgs), { wrapper: wrap() });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadMoreFailed).toBe(true));
    expect(result.current.rows).toHaveLength(200);
    expect(result.current.isError).toBe(true);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(201));
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_offset: 200 });
    expect(result.current.loadMoreFailed).toBe(false);
  });
  it("a failed first read is an error with no rows, never an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => usePagedLedgerEntries(ledgerArgs), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toBeUndefined();
    expect(result.current.loadMoreFailed).toBe(false);
  });
  it("changing the filter starts again from the first page", async () => {
    rpc.mockResolvedValue({ data: full("e", entry), error: null });
    const { result, rerender } = renderHook(({ source }: { source?: string }) => usePagedLedgerEntries({ ...ledgerArgs, source }), { wrapper: wrap(), initialProps: {} });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    rpc.mockClear();
    rerender({ source: "manual" });
    await waitFor(() => expect(callOf("finance_ledger_entries")).toMatchObject({ p_source: "manual", p_offset: 0 }));
  });
  it("the audit log pages the same way", async () => {
    rpc.mockResolvedValueOnce({ data: full("a", log), error: null }).mockResolvedValueOnce({ data: [log("z")], error: null });
    const { result } = renderHook(() => usePagedFinanceAuditLog({ from: "a", to: "b" }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(201));
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_limit: 200, p_offset: 200 });
    expect(result.current.hasMore).toBe(false);
  });
  it("flattenPages holds each id once and keeps the order", () => {
    expect(flattenPages([[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]])).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(flattenPages(undefined)).toBeUndefined();
  });
});
