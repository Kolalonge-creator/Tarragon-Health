const mockRpc = jest.fn();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mockRpc }) }));

import {
  EMPTY_FILTERS,
  EXPORT_ROW_CEILING,
  ExportTooLargeError,
  activeFilterCount,
  fetchAllTransactionsForExport,
  filtersFromParams,
  filtersToParams,
  nairaTextToKobo,
  transactionHref,
  transactionsCsv,
  type TransactionRow,
} from "./transactions";

const row = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  event_id: "order:1",
  occurred_at: "2026-11-02T09:00:00Z",
  event_kind: "payment",
  stream: "membership",
  payer_type: "individual",
  provider: "paystack",
  amount_minor: 10150000,
  fee_minor: 150000,
  currency: "NGN",
  reference: "REF0001",
  record_type: "order",
  record_id: "11111111-1111-1111-1111-111111111111",
  is_renewal: false,
  processing_error: false,
  settlement_status: "settled",
  refunded_minor: 0,
  payer_label: "Ngozi Eze",
  beneficiary_label: null,
  ...over,
});

const page = (rows: TransactionRow[], total: number, offset = 0) => ({
  total,
  total_payments_minor: 0,
  total_refunds_minor: 0,
  limit: 5000,
  offset,
  rows,
});

describe("filters and the URL", () => {
  it("round-trips every filter and keeps the period keys", () => {
    const f = { ...EMPTY_FILTERS, kinds: ["payment", "refund"], payerTypes: ["family_sponsor"], settlement: ["exception"], minNaira: "1000", maxNaira: "250000.50", search: "eze", sort: "amount" as const, dir: "asc" as const, page: 3 };
    const p = filtersToParams(f, new URLSearchParams("period=this_month&compare=none"));
    expect(p.get("period")).toBe("this_month");
    expect(filtersFromParams(p)).toEqual(f);
  });

  it("omits defaults from the URL", () => {
    expect(filtersToParams(EMPTY_FILTERS, new URLSearchParams()).toString()).toBe("");
  });

  it("drops unknown or hostile values instead of passing them to the database", () => {
    const f = filtersFromParams(new URLSearchParams("kind=payment,drop_table,REFUND&payer=boss&min=-5&max=1e9&sort=evil&dir=sideways&page=-4&settlement=settled"));
    expect(f.kinds).toEqual(["payment"]);
    expect(f.payerTypes).toEqual([]);
    expect(f.minNaira).toBe("");
    expect(f.maxNaira).toBe("");
    expect(f.sort).toBe("occurred_at");
    expect(f.dir).toBe("desc");
    expect(f.page).toBe(0);
    expect(f.settlement).toEqual(["settled"]);
  });

  it("counts active filters", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, kinds: ["payment"], minNaira: "5", search: " x " })).toBe(3);
  });
});

describe("nairaTextToKobo", () => {
  it("converts exactly, without floating point", () => {
    expect(nairaTextToKobo("1500.5")).toBe(150050);
    expect(nairaTextToKobo("0.29")).toBe(29);
    expect(nairaTextToKobo("100000")).toBe(10000000);
  });
  it("returns null for empty or unreadable text", () => {
    expect(nairaTextToKobo("")).toBeNull();
    expect(nairaTextToKobo("abc")).toBeNull();
    expect(nairaTextToKobo("1.234")).toBeNull();
  });
});

describe("transactionsCsv", () => {
  it("writes kobo and naira, labels, and a footer naming the period and source", () => {
    const csv = transactionsCsv([row()], { from: "2026-11-01", to: "2026-11-07", generatedAt: "2026-11-07T10:00:00Z" });
    const [header, first] = csv.split("\n");
    expect(header).toContain("Amount (kobo),Amount (naira)");
    expect(first).toContain("10150000,101500,");
    expect(first).toContain("Settled");
    expect(csv).toContain("Period,2026-11-01 to 2026-11-07");
    expect(csv).toContain("Rows,1");
  });

  it("neutralises spreadsheet formulas and quotes commas", () => {
    const csv = transactionsCsv([row({ payer_label: "=HYPERLINK(\"x\")", reference: "A,B" })], { from: "a", to: "b", generatedAt: "c" });
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"A,B"`);
  });
});

describe("fetchAllTransactionsForExport", () => {
  beforeEach(() => mockRpc.mockReset());

  it("pages in export mode until every row is read", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: page([row()], 5002), error: null })
      .mockResolvedValueOnce({ data: page(Array.from({ length: 5000 }, (_, i) => row({ event_id: `e${i}` })), 5002), error: null })
      .mockResolvedValueOnce({ data: page([row({ event_id: "x" }), row({ event_id: "y" })], 5002, 5000), error: null });
    const rows = await fetchAllTransactionsForExport("2026-11-01", "2026-11-07", EMPTY_FILTERS);
    expect(rows).toHaveLength(5002);
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_limit: 1 });
    expect(mockRpc.mock.calls[0][1].p_for_export).toBeUndefined();
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_for_export: true, p_offset: 0 });
    expect(mockRpc.mock.calls[2][1]).toMatchObject({ p_for_export: true, p_offset: 5000 });
  });

  it("refuses an export larger than the ceiling before reading any export page", async () => {
    mockRpc.mockResolvedValueOnce({ data: page([row()], EXPORT_ROW_CEILING + 1), error: null });
    await expect(fetchAllTransactionsForExport("a", "b", EMPTY_FILTERS)).rejects.toBeInstanceOf(ExportTooLargeError);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1].p_for_export).toBeUndefined();
  });

  it("refuses a short read rather than saving a partial file", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: page([row()], 3), error: null })
      .mockResolvedValueOnce({ data: page([row()], 3), error: null })
      .mockResolvedValueOnce({ data: page([], 3, 5000), error: null });
    await expect(fetchAllTransactionsForExport("a", "b", EMPTY_FILTERS)).rejects.toThrow(/nothing was saved/);
  });

  it("surfaces a refused export (no finance.export) as an error", async () => {
    mockRpc.mockResolvedValueOnce({ data: page([row()], 1), error: null }).mockResolvedValueOnce({ data: null, error: { code: "42501", message: "exporting finance data needs the finance.export permission" } });
    await expect(fetchAllTransactionsForExport("a", "b", EMPTY_FILTERS)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("transactionHref", () => {
  it("links known record types and nothing else", () => {
    expect(transactionHref("order", "abc")).toBe("/finance/transactions/order/abc");
    expect(transactionHref("lab_order_refund", "abc")).toBe("/finance/transactions/lab_order_refund/abc");
    expect(transactionHref("profiles", "abc")).toBeNull();
  });
});
