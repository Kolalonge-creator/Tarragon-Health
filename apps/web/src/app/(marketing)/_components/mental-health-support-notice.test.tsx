/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { MentalHealthSupportNotice } from "./mental-health-support-notice";

describe("MentalHealthSupportNotice", () => {
  const html = renderToStaticMarkup(<MentalHealthSupportNotice />);
  it("shows the nearest-hospital guidance and the emergency number from the shared card copy", () => {
    expect(html).toMatch(/nearest hospital/i);
    expect(html).toContain("tel:112");
  });
  it("carries no helpline number (founder decision 2026-10-07)", () => {
    expect(html).not.toMatch(/0800|She Writes|helpline/i);
    const numbers = [...html.matchAll(/tel:([^"]+)/g)].map((m) => m[1]);
    expect(numbers).toEqual(["112"]);
  });
});
