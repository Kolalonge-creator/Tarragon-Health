import {
  anyQueryFailed,
  failedQueryLabels,
  joinLabels,
  serverQueryState,
} from "./server-query-state";

/**
 * Same contract as list-query-state.test.ts, on the server side: a failed
 * read must never be able to come out the same as "there is nothing here".
 */

describe("serverQueryState", () => {
  it("reports a failed read as an error, never as empty", () => {
    expect(serverQueryState({ error: { message: "permission denied" }, count: undefined })).toBe(
      "error"
    );
    // The zero is an artefact of the failure, not a fact about the org.
    expect(serverQueryState({ error: { message: "boom" }, count: 0 })).toBe("error");
    // Even rows in hand alongside an error stay an error: a partial read is
    // an unread board, and "3 open" under a broken query is a worse lie than
    // saying nothing loaded.
    expect(serverQueryState({ error: { message: "boom" }, count: 3 })).toBe("error");
  });

  it("keeps empty and ready apart on a successful read", () => {
    expect(serverQueryState({ error: null, count: 0 })).toBe("empty");
    expect(serverQueryState({ error: null, count: null })).toBe("empty");
    expect(serverQueryState({ error: null, count: undefined })).toBe("empty");
    expect(serverQueryState({ error: null, count: 4 })).toBe("ready");
  });

  it("treats an undefined error the same as a null one", () => {
    // Some call sites spread a result that simply has no error key.
    expect(serverQueryState({ error: undefined, count: 2 })).toBe("ready");
  });
});

describe("anyQueryFailed", () => {
  it("is true when any one of a fan-out failed", () => {
    expect(anyQueryFailed([{ error: null }, { error: null }])).toBe(false);
    expect(anyQueryFailed([{ error: null }, { error: { message: "x" } }])).toBe(true);
  });

  it("is false for no queries at all", () => {
    expect(anyQueryFailed([])).toBe(false);
  });
});

describe("failedQueryLabels", () => {
  it("names only the reads that actually failed", () => {
    expect(
      failedQueryLabels([
        { label: "escalations", error: { message: "x" } },
        { label: "outreach", error: null },
        { label: "consults", error: { message: "y" } },
      ])
    ).toEqual(["escalations", "consults"]);
  });
});

describe("joinLabels", () => {
  it("reads as English inside a sentence", () => {
    expect(joinLabels([])).toBe("");
    expect(joinLabels(["escalations"])).toBe("escalations");
    expect(joinLabels(["escalations", "outreach"])).toBe("escalations and outreach");
    expect(joinLabels(["escalations", "outreach", "consults"])).toBe(
      "escalations, outreach and consults"
    );
  });
});
