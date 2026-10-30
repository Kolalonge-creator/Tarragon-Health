import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATION = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "supabase", "migrations",
  "20261030101027_staff_chat_attachments_reminders_owner_actions.sql",
);

type Reminder = { firstAfterHours: number; gapHours: number; maxReminders: number; sendWindowLagos: { fromHour: number; toHour: number } };

describe("care_messages.unread_reminder mirrors the staff chat migration", () => {
  const v = getProposedConfig<Reminder>("care_messages.unread_reminder").value;
  const sql = readFileSync(MIGRATION, "utf8");
  const fn = /create or replace function private\.remind_patients_of_unread_care_messages[\s\S]*?end \$\$;/.exec(sql)?.[0] ?? "";

  it("finds the function", () => {
    expect(fn.length).toBeGreaterThan(200);
  });

  it("uses the configured timings as its defaults", () => {
    expect(fn).toContain(`p_first interval default interval '${v.firstAfterHours} hours'`);
    expect(fn).toContain(`p_gap interval default interval '${v.gapHours} hours'`);
    expect(fn).toContain(`p_max smallint default ${v.maxReminders}`);
  });

  it("sends only inside the configured Lagos window", () => {
    expect(fn).toContain(`v_hour < ${v.sendWindowLagos.fromHour} or v_hour >= ${v.sendWindowLagos.toHour}`);
  });
});

describe("care_messages.reply_target", () => {
  it("is 24 hours and confirmed", () => {
    const entry = getProposedConfig<{ hours: number }>("care_messages.reply_target");
    expect(entry.value.hours).toBe(24);
    expect(entry.status).toBe("confirmed");
  });
});
