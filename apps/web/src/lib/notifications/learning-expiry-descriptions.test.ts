/**
 * The two learning content expiry templates have generic in-app text (INV-07: no item title, topic, condition, reading or count is shown)
 * and a link that fits the console the recipient uses, and the pages they point at exist.
 */
import { describe, expect, it } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe as describeInApp } from "./describe-in-app";

const page = (...parts: string[]) => existsSync(join(__dirname, "..", "..", "app", "(dashboard)", ...parts, "page.tsx"));

describe("learning content expiry notifications", () => {
  it.each(["learning_expiry_owner", "learning_expiry_cmo_digest"])("%s is generic and shows no item name or number", (template) => {
    const out = describeInApp({ template, payload: { count: 7, title: "Hypertension basics", condition: "hypertension", area: "clinician" } });
    expect(out.text).not.toBe("You have an update");
    expect(out.text).not.toMatch(/hypertension|diabet|basics|\d/i);
  });

  it("an admin owner is sent to the admin page and everyone else to the clinician page", () => {
    expect(describeInApp({ template: "learning_expiry_owner", payload: { area: "admin" } }).href).toBe("/admin/settings/health-education/expiry");
    expect(describeInApp({ template: "learning_expiry_owner", payload: { area: "clinician" } }).href).toBe("/clinician/learning-review");
    expect(describeInApp({ template: "learning_expiry_cmo_digest", payload: {} }).href).toBe("/clinician/learning-review");
  });

  it("an unexpected area value cannot point the link anywhere else", () => {
    const out = describeInApp({ template: "learning_expiry_owner", payload: { area: "https://evil.example/" } });
    expect(out.href).toBe("/clinician/learning-review");
  });

  it("both pages the links point at exist", () => {
    expect(page("admin", "settings", "health-education", "expiry")).toBe(true);
    expect(page("clinician", "learning-review")).toBe(true);
  });
});
