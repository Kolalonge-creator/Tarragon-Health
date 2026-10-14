import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

import { readPendingSoleCmoException } from "./pending-sole-cmo-exception";

type Row = Record<string, unknown>;
function client(cmos: Row[] | null, exceptions: Row[] | null, errors: { cmos?: boolean; ex?: boolean } = {}) {
  const chain = (rows: Row[] | null, err: boolean) => {
    const res = Promise.resolve({ data: err ? null : rows, error: err ? { message: "x" } : null });
    const node: Record<string, unknown> = {};
    node.eq = () => node;
    node.is = () => res;
    node.then = res.then.bind(res);
    return node;
  };
  return {
    from: (t: string) => ({ select: () => (t === "clinical_staff" ? chain(cmos, !!errors.cmos) : chain(exceptions, !!errors.ex)) }),
  } as unknown as SupabaseClient<Database>;
}
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("readPendingSoleCmoException", () => {
  it("waits when there is one CMO and no exception", async () => {
    expect(await readPendingSoleCmoException(client([{ id: "a", is_test: false }], []))).toEqual({ waiting: true, failed: false });
  });
  it("does not wait while an unexpired exception is in force", async () => {
    expect(await readPendingSoleCmoException(client([{ id: "a", is_test: false }], [{ id: "e", expires_at: future }]))).toEqual({ waiting: false, failed: false });
  });
  it("waits again when the only exception has expired", async () => {
    expect(await readPendingSoleCmoException(client([{ id: "a", is_test: false }], [{ id: "e", expires_at: past }]))).toEqual({ waiting: true, failed: false });
  });
  it("never shows the line once a second CMO exists", async () => {
    expect(await readPendingSoleCmoException(client([{ id: "a", is_test: false }, { id: "b", is_test: false }], []))).toEqual({ waiting: false, failed: false });
  });
  it("ignores a test CMO next to the one real CMO", async () => {
    expect(await readPendingSoleCmoException(client([{ id: "a", is_test: false }, { id: "t", is_test: true }], []))).toEqual({ waiting: true, failed: false });
  });
  it("reports a failed read instead of an all-clear", async () => {
    expect(await readPendingSoleCmoException(client(null, [], { cmos: true }))).toEqual({ waiting: false, failed: true });
    expect(await readPendingSoleCmoException(client([{ id: "a", is_test: false }], null, { ex: true }))).toEqual({ waiting: false, failed: true });
  });
});
