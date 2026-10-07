import { describe, expect, it } from "@jest/globals";
import { t } from "./index";

describe("programme.sponsor_sees notice (S75 A3)", () => {
  const body = t("programme.sponsor_sees_body", "en", { minimum: 20 });
  it("states what a sponsor sees and the group floor", () => {
    expect(body).toMatch(/counts of how many people are enrolled/);
    expect(body).toMatch(/groups of at least 20 people/);
  });
  it("names what a sponsor never sees, including the sensitive areas", () => {
    for (const phrase of ["your name", "your readings", "your results", "mental health", "women's health", "pregnancy"]) {
      expect(body).toContain(phrase);
    }
  });
  it("has a title", () => {
    expect(t("programme.sponsor_sees_title", "en")).toBe("What your sponsor sees and never sees");
  });
});
