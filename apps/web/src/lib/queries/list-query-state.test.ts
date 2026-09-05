import { listQueryState } from "./list-query-state";

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
