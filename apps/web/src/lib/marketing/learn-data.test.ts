import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const rpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("./anon-client", () => ({ marketingAnonClient: () => ({ rpc }) }));

import { loadSharedArticle, SHARED_CODE_PATTERN } from "./learn-data";

const row = {
  code: "htn-basics", title: "Basics", summary: null, body: "Body", estimated_minutes: 3, reviewed_by_name: "Dr A",
  reviewed_at: "2026-09-01T00:00:00Z", next_review_due: "2027-09-01", source_reference: "WHO", evidence_source: null,
  self_care_action: "Walk", creator_name: null,
};

beforeEach(() => {
  rpc.mockReset();
});

describe("loadSharedArticle (the shared link, spec 9.8)", () => {
  it("returns the article when the database serves it", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const a = await loadSharedArticle("htn-basics");
    expect(a?.title).toBe("Basics");
    expect(rpc).toHaveBeenCalledWith("learn_shared_article", { p_code: "htn-basics" });
  });

  it("returns null (a calm 404) when the article is unpublished, expired or unknown: the database returns no row", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadSharedArticle("expired-one")).toBeNull();
  });

  it("returns null on a database error rather than rendering stale or partial content", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadSharedArticle("htn-basics")).toBeNull();
  });

  it("never calls the database for a malformed code, and the link carries only that code", async () => {
    expect(await loadSharedArticle("../etc/passwd")).toBeNull();
    expect(await loadSharedArticle("a b")).toBeNull();
    expect(await loadSharedArticle("")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(SHARED_CODE_PATTERN.test("htn_w1_what-your-numbers-mean")).toBe(true);
  });
});
