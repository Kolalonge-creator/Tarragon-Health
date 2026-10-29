import { loadImpactMetrics } from "./impact-data";
import { marketingAnonClient } from "./anon-client";

jest.mock("./anon-client", () => ({ marketingAnonClient: jest.fn() }));

const mockClient = marketingAnonClient as jest.Mock;

function clientReturning(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.order = jest.fn(() => Promise.resolve(result));
  return { from: jest.fn(() => chain) };
}

describe("public impact metrics read", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    mockClient.mockReset();
  });

  it("logs a failed read and returns no metrics instead of throwing", async () => {
    mockClient.mockReturnValue(clientReturning({ data: null, error: { code: "42501", message: "permission denied for function has_permission" } }));
    await expect(loadImpactMetrics()).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("public_impact_metrics read failed"), "42501", "permission denied for function has_permission");
  });

  it("maps rows and does not log on success", async () => {
    mockClient.mockReturnValue(
      clientReturning({ data: [{ metric_key: "k", label: "L", description: null, value: 3, suppressed: false, computed_at: null }], error: null }),
    );
    const out = await loadImpactMetrics();
    expect(out).toEqual([{ metricKey: "k", label: "L", description: null, value: 3, suppressed: false, computedAt: null }]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
