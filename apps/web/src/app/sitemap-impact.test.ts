import sitemap from "./sitemap";
import { loadImpactMetrics } from "@/lib/marketing/impact-data";
import type { ImpactMetric } from "@/lib/marketing/impact-data";

jest.mock("@/lib/marketing/impact-data", () => ({
  ...jest.requireActual("@/lib/marketing/impact-data"),
  loadImpactMetrics: jest.fn(),
}));
jest.mock("@/lib/marketing/resources-data", () => ({ loadResourceArticles: jest.fn(async () => []) }));

const metric = (value: number | null, suppressed: boolean): ImpactMetric => ({
  metricKey: "k", label: "l", description: null, value, suppressed, computedAt: null,
});

async function hasImpact(): Promise<boolean> {
  return (await sitemap()).some((e) => new URL(e.url).pathname === "/impact");
}

describe("sitemap and the impact page's noindex agree (launch check 2026-11-06)", () => {
  it("leaves /impact out while every figure is held back or zero", async () => {
    (loadImpactMetrics as jest.Mock).mockResolvedValue([metric(null, true), metric(0, false)]);
    expect(await hasImpact()).toBe(false);
  });

  it("lists /impact once a real figure clears the privacy floor", async () => {
    (loadImpactMetrics as jest.Mock).mockResolvedValue([metric(31, false)]);
    expect(await hasImpact()).toBe(true);
  });
});
