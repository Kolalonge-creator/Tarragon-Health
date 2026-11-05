/** @jest-environment node */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { hashConfigValue } from "@/lib/go-live/model";

jest.mock("server-only", () => ({}));
const loadSignoffs = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@/lib/go-live/load", () => ({ loadSignoffs: (...args: unknown[]) => loadSignoffs(...args) }));

import { CLINICAL_PROPOSED_ITEM_KEY, readPendingClinicalProposedValues } from "./pending-clinical-proposed-values";

const supabase = {} as never;
const entry = getProposedConfig("documents.narrative_urgent_rules");

beforeEach(() => {
  loadSignoffs.mockReset();
});

describe("readPendingClinicalProposedValues", () => {
  it("shows the narrative rules as one hub line, under /clinician, while unconfirmed", async () => {
    loadSignoffs.mockResolvedValue({ ok: true, data: [] });
    const r = await readPendingClinicalProposedValues(supabase);
    expect(r.failed).toBe(false);
    expect(r.rows.map((x) => x.key)).toEqual(["documents.narrative_urgent_rules"]);
    expect(r.item?.key).toBe(CLINICAL_PROPOSED_ITEM_KEY);
    expect(r.item?.title).toBe("Narrative urgent-finding rules");
    expect(r.item?.href.startsWith("/clinician/")).toBe(true);
  });

  it("drops the line once the CMO has confirmed the exact value in force", async () => {
    loadSignoffs.mockResolvedValue({
      ok: true,
      data: [{ key: entry.key, version: entry.version, value_hash: hashConfigValue(entry.value), owner: "CMO", decision: "confirmed", note: null, signed_at: "2026-11-05T00:00:00Z", signed_by_name: "CMO" }],
    });
    const r = await readPendingClinicalProposedValues(supabase);
    expect(r.item).toBeNull();
    expect(r.rows).toEqual([]);
  });

  it("brings the line back when the value changes after confirmation (the old hash no longer counts)", async () => {
    loadSignoffs.mockResolvedValue({
      ok: true,
      data: [{ key: entry.key, version: entry.version, value_hash: "0".repeat(64), owner: "CMO", decision: "confirmed", note: null, signed_at: "2026-11-05T00:00:00Z", signed_by_name: "CMO" }],
    });
    expect((await readPendingClinicalProposedValues(supabase)).item).not.toBeNull();
  });

  it("reports an unreadable sign-off list as failed, never as nothing waiting", async () => {
    loadSignoffs.mockResolvedValue({ ok: false });
    const r = await readPendingClinicalProposedValues(supabase);
    expect(r.failed).toBe(true);
    expect(r.item).toBeNull();
  });
});
