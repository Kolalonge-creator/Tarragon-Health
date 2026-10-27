import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyCardsBody } from "./weekly-cards-section";

describe("WeeklyCardsBody", () => {
  it("shows nothing when there are no cards", () => {
    expect(renderToStaticMarkup(<WeeklyCardsBody summary={{ cards: [] }} />)).toBe("");
  });

  it("says what was logged in words, with a calm not-enough state and the not-a-diagnosis caption", () => {
    const html = renderToStaticMarkup(
      <WeeklyCardsBody
        summary={{
          cards: [
            { code: "blood_pressure", state: "ready", title: { key: "weekly.bp.title" }, line: { key: "weekly.bp.ready", params: { count: 5, under: 3 } } },
            { code: "medicines", state: "not_enough", title: { key: "weekly.medicines.title" }, line: { key: "weekly.medicines.not_enough" } },
          ],
        }}
      />,
    );
    expect(html).toContain("You logged 5 readings this week. 3 of them were under your target.");
    expect(html).toContain("Not enough yet");
    expect(html).toContain("does not say what your numbers mean");
  });
});
