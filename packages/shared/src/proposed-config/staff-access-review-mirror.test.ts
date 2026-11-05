import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("security.staff_access_review mirrors the migration", () => {
  it("has the same review interval and dormant line as the private functions", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_security_dashboard_and_staff_access_review.sql"));
    if (!file) throw new Error("staff access review migration not found");
    const block = /staff-access-review-begin([\s\S]*?)staff-access-review-end/.exec(readFileSync(join(MIGRATIONS, file), "utf8"))?.[1];
    if (!block) throw new Error("staff-access-review markers not found");
    const fn = (name: string) => Number(new RegExp(`${name}\\(\\)[^$]*\\$\\$ select (\\d+) \\$\\$`).exec(block)?.[1]);
    expect({ review_interval_days: fn("staff_access_review_interval_days"), dormant_after_days: fn("staff_dormant_after_days") }).toEqual(
      getProposedConfig("security.staff_access_review").value
    );
  });
});
