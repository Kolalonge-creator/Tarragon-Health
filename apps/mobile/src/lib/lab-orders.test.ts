/**
 * getResultDocuments used to mint each result document's signed URL with
 * its own Storage createSignedUrl round trip inside
 * Promise.all(rows.map(async (row) => ...)) — a real N+1 sitting right next
 * to a comment on the reviewer-name lookup explaining why THAT query is
 * batched, which this one missed. A patient with N result documents on the
 * mobile Results screen fired N separate signed-URL requests on every load.
 * Mirrors apps/web/src/lib/lab-results/documents.test.ts's proof for the
 * same bug on the web side.
 */
import { supabase } from "./supabase";
import { getResultDocuments, getLabOrders } from "./lab-orders";

const createSignedUrls = jest.fn();

jest.mock("./supabase", () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockStorageFrom = supabase.storage.from as unknown as jest.Mock;

function table(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data, error }).then(resolve),
  };
  for (const method of ["select", "eq", "in", "order"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function row(id: string, filePath: string | null) {
  return {
    id,
    source: "patient",
    original_filename: `${id}.pdf`,
    mime_type: "application/pdf",
    note: null,
    test_code: null,
    created_at: "2026-09-01T00:00:00Z",
    file_path: filePath,
    reviewed_by: null,
    reviewed_at: null,
    patient_interpretation: null,
    next_steps: null,
    interpretation_sent_at: null,
    ai_summary_status: "not_applicable",
  };
}

describe("getResultDocuments — signed URL batching", () => {
  beforeEach(() => {
    createSignedUrls.mockReset();
    mockFrom.mockReset();
    mockStorageFrom.mockReset();
    mockStorageFrom.mockReturnValue({ createSignedUrls });
  });

  it("mints every document's signed URL in a single Storage call, not one per document", async () => {
    const rows = [row("doc-1", "p1/a.pdf"), row("doc-2", "p1/b.pdf"), row("doc-3", null)];
    mockFrom.mockImplementation((tableName: string) => {
      if (tableName === "lab_result_documents") return table(rows);
      if (tableName === "clinical_staff_directory") return table([]);
      throw new Error(`unexpected table ${tableName}`);
    });
    // Deliberately out of request order — a naive index-based zip would
    // silently mis-attribute a URL to the wrong document.
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "p1/b.pdf", signedUrl: "https://signed/b" },
        { path: "p1/a.pdf", signedUrl: "https://signed/a" },
      ],
      error: null,
    });

    const result = await getResultDocuments("patient-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(["p1/a.pdf", "p1/b.pdf"], 300);
    expect(result.data.find((d) => d.id === "doc-1")?.signedUrl).toBe("https://signed/a");
    expect(result.data.find((d) => d.id === "doc-2")?.signedUrl).toBe("https://signed/b");
    // A row with no uploaded file never enters the batch and stays null.
    expect(result.data.find((d) => d.id === "doc-3")?.signedUrl).toBeNull();
  });

  it("never calls the Storage API when there are no result documents", async () => {
    mockFrom.mockImplementation((tableName: string) => {
      if (tableName === "lab_result_documents") return table([]);
      throw new Error(`unexpected table ${tableName}`);
    });

    const result = await getResultDocuments("patient-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("logs a request-level batch failure instead of silently returning every document with a null URL", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const rows = [row("doc-1", "p1/a.pdf"), row("doc-2", "p1/b.pdf")];
    mockFrom.mockImplementation((tableName: string) => {
      if (tableName === "lab_result_documents") return table(rows);
      if (tableName === "clinical_staff_directory") return table([]);
      throw new Error(`unexpected table ${tableName}`);
    });
    createSignedUrls.mockResolvedValue({
      data: null,
      error: { message: "storage: service unavailable" },
    });

    const result = await getResultDocuments("patient-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.every((d) => d.signedUrl === null)).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

/**
 * Regression test for the 2026-09-25 fix: `orderedByName` used to be
 * embedded directly (`clinical_staff!lab_orders_ordered_by_fkey`), which
 * silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS. getLabOrders now issues a second,
 * explicit query against clinical_staff_directory and merges the result —
 * mirrors care-support.test.ts's pattern for the same class of bug.
 */
describe("getLabOrders — orderedByName attribution", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  function labOrdersTable(rows: unknown[]) {
    const builder: Record<string, unknown> = {
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    for (const method of ["select", "eq", "order"]) {
      builder[method] = () => builder;
    }
    return builder;
  }

  function directoryTable(rows: { id: string; full_name: string | null }[]) {
    let requestedIds: string[] = [];
    const builder: Record<string, unknown> = {
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows.filter((r) => requestedIds.includes(r.id)), error: null }).then(resolve),
    };
    builder.select = () => builder;
    builder.in = (_column: string, ids: string[]) => {
      requestedIds = ids;
      return builder;
    };
    return builder;
  }

  function order(overrides: Record<string, unknown> = {}) {
    return {
      id: "order-1",
      order_number: "LO-1",
      status: "ordered",
      urgency: "routine",
      ordered_at: "2026-09-01T00:00:00Z",
      clinical_indication: null,
      ordered_by: "staff-a",
      panel_bundle: { name: "Basic panel", test_codes: ["hba1c"], preparation_instructions: null },
      ...overrides,
    };
  }

  it("attaches the ordering clinician's name via clinical_staff_directory, not an embedded clinical_staff join", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory" ? directoryTable([{ id: "staff-a", full_name: "Dr. A" }]) : labOrdersTable([order()])
    );

    const result = await getLabOrders("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].orderedByName).toBe("Dr. A");
  });

  it("null-gates orderedByName for a self-arranged order with no ordering clinician", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory" ? directoryTable([]) : labOrdersTable([order({ ordered_by: null })])
    );

    const result = await getLabOrders("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].orderedByName).toBeNull();
  });
});
