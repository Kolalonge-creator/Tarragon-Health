import { describe, expect, it, jest } from "@jest/globals";

const loadSharedArticle = jest.fn<(code: string) => Promise<unknown>>();
jest.mock("@/lib/marketing/learn-data", () => ({ loadSharedArticle: (c: string) => loadSharedArticle(c) }));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
jest.mock("@/components/learning/share-lesson-buttons", () => ({ ShareLessonButtons: () => null }));
jest.mock("../../_components/section", () => ({ Section: ({ children }: { children: unknown }) => children }));

import SharedArticlePage from "./page";

describe("shared article page", () => {
  it("answers 404 (notFound) for an unpublished or expired article, never an empty page", async () => {
    loadSharedArticle.mockResolvedValue(null);
    await expect(SharedArticlePage({ params: Promise.resolve({ code: "gone" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders a servable article", async () => {
    loadSharedArticle.mockResolvedValue({
      code: "ok", title: "Ok", summary: null, body: "B", estimatedMinutes: 2, reviewedByName: "Dr A", reviewedAt: "2026-09-01T00:00:00Z",
      nextReviewDue: "2027-01-01", sourceReference: "WHO", evidenceSource: null, selfCareAction: "Walk", creatorName: null,
    });
    const el = await SharedArticlePage({ params: Promise.resolve({ code: "ok" }) });
    expect(el).toBeTruthy();
  });
});
