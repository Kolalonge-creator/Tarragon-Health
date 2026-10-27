import { z } from "zod";

/** Escapes one CSV cell and neutralises a leading formula character. */
export function csvCell(v: string | number | null | undefined): string {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
export const csvLine = (...c: (string | number | null | undefined)[]): string => c.map(csvCell).join(",");

// ---------------------------------------------------------------------------
// Eligibility file (S79, 24.1)
// ---------------------------------------------------------------------------
export const UPLOAD_MODES = ["add", "remove", "replace"] as const;
export type UploadMode = (typeof UPLOAD_MODES)[number];

export type EligibilityRow = Record<string, string>;
const COLUMNS = ["phone", "email", "full_name", "department", "location", "employment_status", "employee_reference", "job_category", "eligible_from", "eligible_until"] as const;
const ALIASES: Record<string, (typeof COLUMNS)[number]> = {
  phone: "phone", mobile: "phone", phone_number: "phone", telephone: "phone", email: "email", email_address: "email", full_name: "full_name", name: "full_name",
  department: "department", dept: "department", location: "location", branch: "location", site: "location", employment_status: "employment_status", status: "employment_status",
  employee_reference: "employee_reference", employee_id: "employee_reference", staff_id: "employee_reference", reference: "employee_reference", job_category: "job_category",
  eligible_from: "eligible_from", start_date: "eligible_from", eligible_until: "eligible_until", end_date: "eligible_until",
};

/** Splits one line, honouring double quotes ("" is a quote). */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export type ParsedEligibility = { rows: EligibilityRow[]; unknownColumns: string[]; usedHeader: boolean };

/**
 * Reads a pasted or uploaded eligibility file. Understands a header row by column name (any order, common HR names, comma, semicolon or tab), or falls
 * back to the original fixed order (phone, email, full_name, department, location, employment_status) when there is no header. Blank lines are skipped.
 * Nothing is validated here beyond shape: the database stages and validates every row.
 */
export function parseEligibilityFile(raw: string): ParsedEligibility {
  const lines = raw
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], unknownColumns: [], usedHeader: false };
  const first = lines[0]!;
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const head = splitLine(first, delim).map((h) => h.toLowerCase().replace(/[\s-]+/g, "_"));
  const mapped = head.map((h) => ALIASES[h]);
  const usedHeader = mapped.some((m) => m === "phone" || m === "email");
  const rows: EligibilityRow[] = [];
  const unknownColumns = usedHeader ? head.filter((_, i) => !mapped[i]) : [];
  for (const [i, line] of lines.entries()) {
    if (usedHeader && i === 0) continue;
    const cells = splitLine(line, delim);
    const row: EligibilityRow = {};
    if (usedHeader) {
      mapped.forEach((col, idx) => {
        if (col && cells[idx]) row[col] = cells[idx]!;
      });
    } else {
      COLUMNS.slice(0, 6).forEach((col, idx) => {
        if (cells[idx]) row[col] = cells[idx]!;
      });
    }
    rows.push(row);
  }
  return { rows, unknownColumns, usedHeader };
}

const stageSchema = z.object({
  ok: z.literal(true),
  batch_id: z.string().uuid(),
  summary: z.object({ insert: z.number(), update: z.number(), end: z.number(), no_change: z.number(), errors: z.number(), active_roster: z.number(), end_share_pct: z.number() }),
});
export type StageResult = z.infer<typeof stageSchema>;
export const parseStageResult = (d: unknown): StageResult | null => {
  const r = stageSchema.safeParse(d);
  return r.success ? r.data : null;
};

const reportSchema = z.array(z.object({ row: z.number(), status: z.string(), reason: z.string().nullable(), contact: z.string().nullable() }));
export function rosterErrorReportToCsv(data: unknown): string | null {
  const r = reportSchema.safeParse(data);
  if (!r.success) return null;
  return [csvLine("row", "status", "reason", "contact_masked"), ...r.data.map((x) => csvLine(x.row, x.status, x.reason ?? "", x.contact ?? ""))].join("\n") + "\n";
}

/** Why a commit or approval was refused, in words an HR administrator can act on. */
export function approvalReasonText(reason: string): string {
  switch (reason) {
    case "has_errors":
      return "This file has rows with problems. A file that removes people is only applied when every row is correct. Fix the rows in the error report and upload again.";
    case "second_approver_needed":
      return "Because this file ends people's access, a second person (or Tarragon) must approve it. Ask a colleague to open this page and approve.";
    case "tarragon_approval_needed":
      return "This file would end access for a large share of your list. Tarragon must approve it. Contact your Tarragon account manager.";
    case "expired":
      return "This upload waited too long and was cleared. Upload the file again.";
    case "not_staged":
      return "This upload is no longer waiting for approval.";
    default:
      return "This could not be approved.";
  }
}

// ---------------------------------------------------------------------------
// Privacy ledger and usage (S79, 24.3, 24.4)
// ---------------------------------------------------------------------------
const ledgerSchema = z.object({
  minimum_cell: z.number().int(),
  entries: z.array(z.object({ period: z.string(), programme: z.string(), tile: z.string(), reason: z.string(), count: z.number().nullable().optional() })),
});
export type PrivacyLedger = z.infer<typeof ledgerSchema>;
export const parsePrivacyLedger = (d: unknown): PrivacyLedger | null => {
  const r = ledgerSchema.safeParse(d);
  return r.success ? r.data : null;
};

const TILE_WORDS: Record<string, string> = {
  members: "How many members agreed to share",
  bp_control_90d: "Blood pressure control at day 90",
  change_among_measured: "Change in blood pressure",
  adherence_separate: "Medicine adherence",
  engagement_separate: "Engagement",
  month: "The whole month",
  service_lines: "Service lines in the usage statement",
};
const REASON_WORDS: Record<string, string> = {
  under_minimum: "Too few people to show without risking that someone is recognised.",
  small_cell: "One group inside it was too small, so the counts were withheld together.",
  held_back_small_change: "The group differed from the last published month by only a few people, so this month was held back.",
  withheld: "Withheld.",
};
export function describeLedgerEntry(e: PrivacyLedger["entries"][number], minimum: number): string {
  const what = TILE_WORDS[e.tile] ?? e.tile;
  const why = REASON_WORDS[e.reason] ?? "Withheld.";
  const extra = e.tile === "service_lines" && e.count ? ` ${e.count} smaller line(s) were combined into other services.` : "";
  return `${what}: ${why}${extra} The smallest group shown is ${minimum}.`;
}

const statementsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    period: z.string(),
    total_kobo: z.number().int(),
    statement: z.object({ lines: z.array(z.object({ service_code: z.string(), units: z.number().int(), amount_kobo: z.number().int() })), other_services_kobo: z.number().int() }),
    invoice: z.object({ id: z.string().uuid(), status: z.string(), amount_kobo: z.number().int(), due_at: z.string().nullable() }).nullable(),
  }),
);
export type UsageStatements = z.infer<typeof statementsSchema>;
export const parseUsageStatements = (d: unknown): UsageStatements | null => {
  const r = statementsSchema.safeParse(d);
  return r.success ? r.data : null;
};
export const nairaFromKobo = (k: number): string => `NGN ${(k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Procurement pack (S79, 24.6)
// ---------------------------------------------------------------------------
const packSchema = z.object({
  sponsor: z.string(),
  generated_at: z.string(),
  minimum_cell: z.number().int(),
  programmes: z.array(
    z.object({ name: z.string(), status: z.string(), valid_from: z.string(), valid_to: z.string(), latest_period: z.string().nullable(), figures: z.record(z.string(), z.unknown()).nullable() }),
  ),
  contracts: z.array(
    z.object({ name: z.string(), status: z.string(), effective_from: z.string().nullable(), effective_to: z.string().nullable(), per_employee_per_year_kobo: z.number(), employee_count: z.number() }),
  ),
  usage: z.array(
    z.object({
      period: z.string(),
      total_kobo: z.number(),
      other_services_kobo: z.number().nullable().optional(),
      lines: z.array(z.object({ service_code: z.string(), units: z.number(), amount_kobo: z.number() })).nullable().optional(),
    }),
  ),
  configuration: z.object({ version: z.number(), pathways: z.array(z.string()), item_codes: z.array(z.string()), rewards_budget_kobo: z.number(), approved_at: z.string().nullable() }).nullable(),
  privacy_ledger: z.array(z.object({ period: z.string(), programme: z.string(), tile: z.string(), reason: z.string() })),
  methodology: z.string(),
});
export type ProcurementPack = z.infer<typeof packSchema>;
export const parseProcurementPack = (d: unknown): ProcurementPack | null => {
  const r = packSchema.safeParse(d);
  return r.success ? r.data : null;
};

/** Flattens a figures object to key/value rows; withheld tiles say so and carry nothing else. */
export function figureRows(figures: Record<string, unknown> | null): [string, string][] {
  if (!figures) return [["figures", "none published yet"]];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(figures)) {
    if (["cohort", "definition", "limitations", "not_a_causal_claim", "generated_at", "range", "minimum_cell"].includes(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (o["suppressed"] === true) {
        out.push([k, `withheld (${String(o["reason"] ?? "small group")})`]);
        continue;
      }
      for (const [kk, vv] of Object.entries(o)) if (kk !== "suppressed" && (typeof vv === "number" || typeof vv === "string")) out.push([`${k}.${kk}`, String(vv)]);
    }
  }
  return out;
}

export function packToCsv(p: ProcurementPack): string {
  const rows = [csvLine("section", "item", "key", "value"), csvLine("pack", p.sponsor, "generated_at", p.generated_at), csvLine("pack", p.sponsor, "minimum_group_size", p.minimum_cell)];
  for (const g of p.programmes) {
    rows.push(csvLine("programme", g.name, "status", g.status), csvLine("programme", g.name, "valid", `${g.valid_from} to ${g.valid_to}`), csvLine("programme", g.name, "latest_month", g.latest_period ?? "none"));
    for (const [k, v] of figureRows(g.figures)) rows.push(csvLine("programme_figures", g.name, k, v));
  }
  for (const c of p.contracts) {
    rows.push(
      csvLine("contract", c.name, "status", c.status),
      csvLine("contract", c.name, "term", `${c.effective_from ?? ""} to ${c.effective_to ?? ""}`),
      csvLine("contract", c.name, "per_employee_per_year_kobo", c.per_employee_per_year_kobo),
      csvLine("contract", c.name, "employee_count", c.employee_count),
    );
  }
  for (const u of p.usage) {
    rows.push(csvLine("usage", u.period, "total_kobo", u.total_kobo));
    for (const l of u.lines ?? []) rows.push(csvLine("usage", u.period, `${l.service_code}.units`, l.units), csvLine("usage", u.period, `${l.service_code}.amount_kobo`, l.amount_kobo));
    if (u.other_services_kobo) rows.push(csvLine("usage", u.period, "other_services_kobo", u.other_services_kobo));
  }
  if (p.configuration) {
    const v = `v${p.configuration.version}`;
    rows.push(
      csvLine("configuration", v, "pathways", p.configuration.pathways.join(" ")),
      csvLine("configuration", v, "sponsored_items", p.configuration.item_codes.join(" ")),
      csvLine("configuration", v, "rewards_budget_kobo", p.configuration.rewards_budget_kobo),
    );
  }
  for (const e of p.privacy_ledger) rows.push(csvLine("privacy_ledger", e.period, `${e.programme}/${e.tile}`, e.reason));
  rows.push(csvLine("methodology", "", "note", p.methodology));
  return rows.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Code sheet (S79, function g)
// ---------------------------------------------------------------------------
const sheetSchema = z.object({
  sponsor: z.string(),
  organisation_code: z.string().nullable(),
  programmes: z.array(z.object({ name: z.string(), code: z.string(), valid_to: z.string() })),
});
export type CodeSheet = z.infer<typeof sheetSchema>;
export const parseCodeSheet = (d: unknown): CodeSheet | null => {
  const r = sheetSchema.safeParse(d);
  return r.success ? r.data : null;
};
/** A code is read off a slide and typed by hand: group it in fours. */
export const groupCode = (c: string): string => c.replace(/(.{4})(?=.)/g, "$1 ");
