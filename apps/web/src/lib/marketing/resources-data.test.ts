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

describe("marketing resources before the provenance migration has applied", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    mockClient.mockReset();
  });

  const row = {
    slug: "db-only-article",
    title: "From the database",
    description: "d",
    category: "Blood pressure",
    read_minutes: 4,
    related_href: null,
    related_label: null,
    sections: [{ heading: "H", paragraphs: ["p"] }],
    reviewed_by_name: null,
    reviewed_at: null,
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
  };

  it("retries with the old column list on 42703 instead of falling back to the static library", async () => {
    const selects: string[] = [];
    let call = 0;
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn((cols: string) => {
      selects.push(cols);
      return chain;
    });
    chain.eq = jest.fn(() => chain);
    chain.order = jest.fn(() =>
      Promise.resolve(call++ === 0 ? { data: null, error: { code: "42703", message: "column author_name does not exist" } } : { data: [row], error: null })
    );
    mockClient.mockReturnValue({ from: jest.fn(() => chain) });

    const articles = await loadResourceArticles();
    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain("author_name");
    expect(selects[1]).not.toContain("author_name");
    expect(articles.map((a) => a.slug)).toEqual(["db-only-article"]);
    expect(articles[0]!.authorName).toBeNull();
    expect(articles[0]!.references).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
