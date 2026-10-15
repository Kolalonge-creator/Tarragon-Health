import { fetchStaffFolios, isMissingFunctionError, withStaffFolios } from "./staff-folio";

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
  it("makes no call for no ids and ignores blanks and duplicates", async () => {
    const c = client({});
    expect((await fetchStaffFolios(c, [])).size).toBe(0);
    expect((await fetchStaffFolios(c, [null, undefined, ""])).size).toBe(0);
    expect(c.rpc).not.toHaveBeenCalled();
    const d = client({ rpc: { data: [{ clinical_staff_id: "s1", credential_number: "MDCN/1" }] } });
    await fetchStaffFolios(d, ["s1", "s1"]);
    expect(d.rpc).toHaveBeenCalledWith("clinical_staff_folio", { p_staff_ids: ["s1"] });
  });

  it("maps the function's rows and never touches the table when the function exists", async () => {
    const c = client({ rpc: { data: [{ clinical_staff_id: "s1", credential_number: "MDCN/1" }, { clinical_staff_id: "s2", credential_number: null }] } });
    const m = await fetchStaffFolios(c, ["s1", "s2", "s3"]);
    expect(m.get("s1")).toBe("MDCN/1");
    expect(m.get("s2")).toBeNull();
    expect(m.has("s3")).toBe(false);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("DEPLOY WINDOW: falls back to the column while the function does not exist yet", async () => {
    for (const error of [{ code: "PGRST202" }, { code: "42883" }, { message: "Could not find the function public.clinical_staff_folio(p_staff_ids) in the schema cache" }]) {
      const c = client({ rpc: { error }, table: { data: [{ id: "s1", credential_number: "MDCN/1" }] } });
      const m = await fetchStaffFolios(c, ["s1"]);
      expect(m.get("s1")).toBe("MDCN/1");
      expect(c.select).toHaveBeenCalledWith("id, credential_number");
    }
  });

  it("a refusal (42501) or any other failure yields no folio and no fallback read: a screen shows no number", async () => {
    for (const error of [{ code: "42501", message: "not entitled" }, { code: "XX000", message: "boom" }]) {
      const c = client({ rpc: { error }, table: { data: [{ id: "s1", credential_number: "LEAK" }] } });
      expect((await fetchStaffFolios(c, ["s1"])).size).toBe(0);
      expect(c.from).not.toHaveBeenCalled();
    }
  });

  it("after the lock the fallback read is refused too, and that is also just 'no folio'", async () => {
    const c = client({ rpc: { error: { code: "PGRST202" } }, table: { error: { code: "42501", message: "permission denied for table clinical_staff" } } });
    expect((await fetchStaffFolios(c, ["s1"])).size).toBe(0);
  });

  it("isMissingFunctionError is exact about what counts as missing", () => {
    expect(isMissingFunctionError(null)).toBe(false);
    expect(isMissingFunctionError({ code: "42501" })).toBe(false);
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
  });

  it("withStaffFolios adds credential_number to each row, null when none", async () => {
    const c = client({ rpc: { data: [{ clinical_staff_id: "s1", credential_number: "MDCN/1" }] } });
    const rows = await withStaffFolios(c, [{ id: "s1", full_name: "A" }, { id: "s2", full_name: "B" }]);
    expect(rows).toEqual([
      { id: "s1", full_name: "A", credential_number: "MDCN/1" },
      { id: "s2", full_name: "B", credential_number: null },
    ]);
  });
});
