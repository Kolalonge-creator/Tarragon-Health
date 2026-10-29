import { loadResourceArticle, loadResourceArticles } from "./resources-data";
import { marketingAnonClient } from "./anon-client";

jest.mock("./anon-client", () => ({ marketingAnonClient: jest.fn() }));

const mockClient = marketingAnonClient as jest.Mock;

function clientReturning(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.order = jest.fn(() => Promise.resolve(result));
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  return { from: jest.fn(() => chain) };
}

describe("marketing resources reads", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    mockClient.mockReset();
  });

  it("logs a failed list read and still serves the static fallback", async () => {
    mockClient.mockReturnValue(clientReturning({ data: null, error: { code: "42501", message: "permission denied for function is_admin" } }));
    const articles = await loadResourceArticles();
    expect(articles.length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("marketing_resources read failed"), "42501", "permission denied for function is_admin");
  });

  it("logs a failed single read and does not throw", async () => {
    mockClient.mockReturnValue(clientReturning({ data: null, error: { code: "42501", message: "denied" } }));
    await expect(loadResourceArticle("no-such-slug")).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("does not log on a successful empty read (that is a content question, not an error)", async () => {
    mockClient.mockReturnValue(clientReturning({ data: [], error: null }));
    await loadResourceArticles();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
