/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): nothing on the server hands out a client-uploaded file before the server has checked
 * it. A waiting file is checked inline first; a refused or still-unchecked file is withheld; a failed lookup withholds all.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const run = jest.fn<(service: unknown, options: { only: { bucket: string; name: string; ownerId: string } }) => Promise<unknown>>();
jest.mock("./verify-stored-upload", () => ({ runClientUploadChecks: (s: unknown, o: { only: { bucket: string; name: string; ownerId: string } }) => run(s, o) }));

import { blockedUncheckedPaths, isClearedForReading } from "./cleared-for-reading";

type Row = { object_name: string; status: string; owner_id: string };
let lookups: Row[][];
let lookupError = false;
const rpcCalls: string[] = [];
const service = {
  rpc: async (fn: string) => {
    rpcCalls.push(fn);
    if (lookupError) return { data: null, error: { message: "down" } };
    return { data: lookups.shift() ?? [], error: null };
  },
} as unknown as SupabaseClient<Database>;

beforeEach(() => {
  lookups = [];
  lookupError = false;
  rpcCalls.length = 0;
  run.mockReset();
  run.mockResolvedValue({ checked: 1, outcomes: {} });
});

describe("blockedUncheckedPaths", () => {
  it("never looks anything up for a bucket clients cannot write to directly", async () => {
    expect(await blockedUncheckedPaths(service, "lab-result-documents", ["a"])).toEqual(new Set());
    expect(rpcCalls).toHaveLength(0);
  });

  it("files with no check row (legacy, or written by the server) and cleared files are handed out", async () => {
    lookups = [[{ object_name: "u/clean.jpg", status: "clean", owner_id: "u" }, { object_name: "u/c2.jpg", status: "cleaned", owner_id: "u" }]];
    expect(await blockedUncheckedPaths(service, "meal-photos", ["u/legacy.jpg", "u/clean.jpg", "u/c2.jpg"])).toEqual(new Set());
    expect(run).not.toHaveBeenCalled();
  });

  it("a quarantined file is withheld", async () => {
    lookups = [[{ object_name: "u/bad.jpg", status: "quarantined", owner_id: "u" }]];
    expect(await blockedUncheckedPaths(service, "care-message-attachments", ["u/bad.jpg"])).toEqual(new Set(["u/bad.jpg"]));
  });

  it("a waiting file is checked inline for its own writer, then handed out once cleared", async () => {
    lookups = [[{ object_name: "u/new.jpg", status: "pending", owner_id: "u" }], [{ object_name: "u/new.jpg", status: "cleaned", owner_id: "u" }]];
    expect(await isClearedForReading(service, "patient-documents", "u/new.jpg")).toBe(true);
    expect(run.mock.calls[0]?.[1]).toEqual({ limit: 1, only: { bucket: "patient-documents", name: "u/new.jpg", ownerId: "u" } });
  });

  it("a file still not cleared after the inline check (refused, or the check keeps failing) is withheld", async () => {
    lookups = [[{ object_name: "u/new.jpg", status: "error", owner_id: "u" }], [{ object_name: "u/new.jpg", status: "error", owner_id: "u" }]];
    expect(await isClearedForReading(service, "patient-documents", "u/new.jpg")).toBe(false);
  });

  it("a failed status lookup withholds every path: a gate that opens on error is no gate", async () => {
    lookupError = true;
    expect(await blockedUncheckedPaths(service, "meal-photos", ["a", "b"])).toEqual(new Set(["a", "b"]));
  });
});
