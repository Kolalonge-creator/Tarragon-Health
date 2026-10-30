const noop = () => undefined;
import { fetchStaffFolios, isMissingFunctionError, searchStaffIdsByFolio, withStaffFolios } from "./staff-folio";

type Err = { code?: string; message?: string } | null;

function client(opts: {
  rpc?: { data?: { clinical_staff_id: string; credential_number: string | null }[] | null; error?: Err };
  table?: { data?: { id: string; credential_number: string | null }[] | null; error?: Err };
}) {
  const inFn = jest.fn().mockResolvedValue({ data: opts.table?.data ?? null, error: opts.table?.error ?? null });
  const select = jest.fn().mockReturnValue({ in: inFn });
  const from = jest.fn().mockReturnValue({ select });
  const rpc = jest.fn().mockResolvedValue({ data: opts.rpc?.data ?? null, error: opts.rpc?.error ?? null });
  return { rpc, from, select, inFn };
}

describe("fetchStaffFolios (OQ-358: the folio comes from the folio function)", () => {
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    errSpy = jest.spyOn(console, "error").mockImplementation(noop);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(noop);
  });
  afterEach(() => jest.restoreAllMocks());

  it("makes no call for no ids and ignores blanks and duplicates", async () => {
    const c = client({});
    expect((await fetchStaffFolios(c as never, [])).size).toBe(0);
    expect((await fetchStaffFolios(c as never, [null, undefined, ""] as never)).size).toBe(0);
    expect(c.rpc).not.toHaveBeenCalled();
    const d = client({ rpc: { data: [{ clinical_staff_id: "s1", credential_number: "MDCN/1" }] } });
    await fetchStaffFolios(d as never, ["s1", "s1"]);
    expect(d.rpc).toHaveBeenCalledWith("clinical_staff_folio", { p_staff_ids: ["s1"] });
  });

  it("maps the function's rows and never touches the table when the function exists", async () => {
    const c = client({ rpc: { data: [{ clinical_staff_id: "s1", credential_number: "MDCN/1" }, { clinical_staff_id: "s2", credential_number: null }] } });
    const m = await fetchStaffFolios(c as never, ["s1", "s2", "s3"]);
    expect(m.get("s1")).toBe("MDCN/1");
    expect(m.get("s2")).toBeNull();
    expect(m.has("s3")).toBe(false);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("DEPLOY WINDOW: falls back to the column while the function does not exist yet", async () => {
    for (const error of [{ code: "PGRST202" }, { code: "42883", message: "function public.clinical_staff_folio(uuid[]) does not exist" }]) {
      const c = client({ rpc: { error }, table: { data: [{ id: "s1", credential_number: "MDCN/1" }] } });
      const m = await fetchStaffFolios(c as never, ["s1"]);
      expect(m.get("s1")).toBe("MDCN/1");
      expect(c.select).toHaveBeenCalledWith("id, credential_number");
      expect(warnSpy).toHaveBeenCalled();
    }
  });

  it("a missing function INSIDE the folio function (42883 naming something else) is a failure, not the deploy window: no table read, and it is logged", async () => {
    const c = client({ rpc: { error: { code: "42883", message: "function private.can_credential_review() does not exist" } }, table: { data: [{ id: "s1", credential_number: "LEAK" }] } });
    expect((await fetchStaffFolios(c as never, ["s1"])).size).toBe(0);
    expect(c.from).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith("clinical_staff_folio lookup failed", "42883");
  });

  it("a refusal (42501) or any other failure yields no folio and no fallback read: a screen shows no number", async () => {
    for (const error of [{ code: "42501", message: "not entitled" }, { code: "XX000", message: "boom" }]) {
      const c = client({ rpc: { error }, table: { data: [{ id: "s1", credential_number: "LEAK" }] } });
      expect((await fetchStaffFolios(c as never, ["s1"])).size).toBe(0);
      expect(c.from).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
    }
  });

  it("after the lock the fallback read is refused too, and that is also just 'no folio'", async () => {
    const c = client({ rpc: { error: { code: "PGRST202" } }, table: { error: { code: "42501", message: "permission denied for table clinical_staff" } } });
    expect((await fetchStaffFolios(c as never, ["s1"])).size).toBe(0);
  });

  it("isMissingFunctionError is exact about what counts as missing", () => {
    expect(isMissingFunctionError(null)).toBe(false);
    expect(isMissingFunctionError({ code: "42501" })).toBe(false);
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883", message: "function public.clinical_staff_folio(uuid[]) does not exist" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883", message: "function private.other() does not exist" })).toBe(false);
  });

  it("withStaffFolios adds credential_number to each row, null when none", async () => {
    const c = client({ rpc: { data: [{ clinical_staff_id: "s1", credential_number: "MDCN/1" }] } });
    const rows = await withStaffFolios(c as never, [{ id: "s1", full_name: "A" }, { id: "s2", full_name: "B" }]);
    expect(rows).toEqual([
      { id: "s1", full_name: "A", credential_number: "MDCN/1" },
      { id: "s2", full_name: "B", credential_number: null },
    ]);
  });
});

describe("searchStaffIdsByFolio (OQ-666: the admin / CMO search matches a folio through the staff-only function)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("calls the function with the term and returns the ids", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [{ clinical_staff_id: "s1" }, { clinical_staff_id: "s2" }], error: null });
    expect(await searchStaffIdsByFolio({ rpc } as never, "MDCN/12")).toEqual(["s1", "s2"]);
    expect(rpc).toHaveBeenCalledWith("search_clinical_staff_by_folio", { p_term: "MDCN/12" });
  });

  it("returns no ids (and logs) when the call fails or the function is not deployed yet, and never reads the table", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(noop);
    for (const error of [{ code: "PGRST202" }, { code: "42501" }]) {
      const rpc = jest.fn().mockResolvedValue({ data: null, error });
      const from = jest.fn();
      expect(await searchStaffIdsByFolio({ rpc, from } as never, "MDCN/12")).toEqual([]);
      expect(from).not.toHaveBeenCalled();
    }
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it("treats a null result as no match", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    expect(await searchStaffIdsByFolio({ rpc } as never, "x1")).toEqual([]);
  });
});
