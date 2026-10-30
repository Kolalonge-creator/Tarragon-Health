import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CARE_MESSAGE_ACTIONS, CARE_MESSAGE_ACTION_KINDS } from "./action-kinds";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");

describe("care message action kinds", () => {
  it("match the kinds the database allows", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_staff_chat_attachments_reminders_owner_actions.sql"));
    const sql = readFileSync(join(MIGRATIONS, file as string), "utf8");
    const allowed = /kind\s+text not null check \(kind in \(([^)]*)\)\)/.exec(sql)?.[1]
      .split(",")
      .map((k) => k.trim().replace(/'/g, ""))
      .sort();
    expect(allowed).toEqual([...CARE_MESSAGE_ACTION_KINDS].sort());
  });

  it("only ever point inside the patient app", () => {
    for (const { href } of Object.values(CARE_MESSAGE_ACTIONS)) expect(href.startsWith("/patient/")).toBe(true);
  });
});
