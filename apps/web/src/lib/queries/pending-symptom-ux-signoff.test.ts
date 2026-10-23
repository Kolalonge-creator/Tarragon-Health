import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { readPendingSymptomUxSignoff, waitingSymptomUx } from "./pending-symptom-ux-signoff";

const row = (kind: string, version: number, over: Record<string, unknown> = {}) => ({ kind, version, is_active: false, approved_at: null, rules: { version }, ...over });
const client = (res: unknown): SupabaseClient<Database> =>
  ({ from: () => ({ select: () => (res === "throw" ? Promise.reject(new Error("x")) : Promise.resolve(res)) }) }) as unknown as SupabaseClient<Database>;

describe("waitingSymptomUx", () => {
  it("lists the unsigned draft of each kind with its own rules", () => {
    const waiting = waitingSymptomUx([row("checkback", 1), row("describe", 1), row("explainer", 1), row("safety_net", 1)]);
    expect(waiting.map((w) => w.kind)).toEqual(["checkback", "describe", "explainer", "safety_net"]);
    expect(waiting[0]).toMatchObject({ version: 1, rules: { version: 1 } });
  });
  it("lists nothing for a kind that is signed and live, and the newer draft when there is one", () => {
    const waiting = waitingSymptomUx([row("checkback", 1, { is_active: true, approved_at: "2026-10-22T00:00:00Z" }), row("describe", 1, { is_active: true, approved_at: "2026-10-22T00:00:00Z" }), row("describe", 2)]);
    expect(waiting).toEqual([{ kind: "describe", version: 2, rules: { version: 2 } }]);
  });
  it("does not offer an older unsigned draft once a newer version is live", () => {
    expect(waitingSymptomUx([row("explainer", 1), row("explainer", 2, { is_active: true, approved_at: "2026-10-22T00:00:00Z" })])).toEqual([]);
  });
});

describe("readPendingSymptomUxSignoff", () => {
  it("reads the table, and a failed read says so (never an all-clear)", async () => {
    expect(await readPendingSymptomUxSignoff(client({ data: [row("checkback", 1)], error: null }))).toMatchObject({ failed: false, waiting: [{ kind: "checkback", version: 1 }] });
    expect((await readPendingSymptomUxSignoff(client({ data: null, error: { message: "x" } }))).failed).toBe(true);
    expect((await readPendingSymptomUxSignoff(client("throw"))).failed).toBe(true);
  });
});
