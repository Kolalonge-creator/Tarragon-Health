import { listQueryState, refreshQueryState } from "./list-query-state";

/**
 * The whole point of this helper is that "it failed" can never come out the
 * same as "you have nothing", so that is what these assert.
 */

describe("listQueryState", () => {
  it("reports a failed read as an error, never as empty", () => {
    expect(listQueryState({ isLoading: false, isError: true, count: undefined })).toBe("error");
    // Even with a zero count in hand, a failed query is an error: the zero is
    // an artefact of the failure, not a fact about the patient.
    expect(listQueryState({ isLoading: false, isError: true, count: 0 })).toBe("error");
  });

  it("keeps loading, empty and ready apart", () => {
    expect(listQueryState({ isLoading: true, isError: false, count: undefined })).toBe("loading");
    expect(listQueryState({ isLoading: false, isError: false, count: 0 })).toBe("empty");
    expect(listQueryState({ isLoading: false, isError: false, count: undefined })).toBe("empty");
    expect(listQueryState({ isLoading: false, isError: false, count: null })).toBe("empty");
    expect(listQueryState({ isLoading: false, isError: false, count: 2 })).toBe("ready");
  });

  it("an error outranks a concurrent loading flag", () => {
    // A refetch after a failure can leave both set; the honest answer is the
    // failure, not a spinner that hides it.
    expect(listQueryState({ isLoading: true, isError: true, count: undefined })).toBe("error");
  });
});

describe("refreshQueryState", () => {
  it("keeps a failed refresh apart from a failed first load", () => {
    // React Query retains `data` and flips status to error when a background
    // refetch fails. The whole point of this function is that those two are
    // not the same event.
    expect(refreshQueryState({ isLoading: false, isError: true, hasData: true })).toBe("stale");
    expect(refreshQueryState({ isLoading: false, isError: true, hasData: false })).toBe("failed");
  });

  it("never reports a first-load failure as merely stale", () => {
    // isLoading can still be true alongside an error on a retrying first
    // fetch; with nothing loaded, that is a failure, not old data.
    expect(refreshQueryState({ isLoading: true, isError: true, hasData: false })).toBe("failed");
  });

  it("reports loading and ready when nothing has failed", () => {
    expect(refreshQueryState({ isLoading: true, isError: false, hasData: false })).toBe("loading");
    expect(refreshQueryState({ isLoading: false, isError: false, hasData: true })).toBe("ready");
    // A successful read that returned nothing is still a successful read.
    expect(refreshQueryState({ isLoading: false, isError: false, hasData: false })).toBe("ready");
  });
});
