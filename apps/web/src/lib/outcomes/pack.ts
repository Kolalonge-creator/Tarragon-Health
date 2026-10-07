import { z } from "zod";
import { allStrings, causalWordingHits } from "@tarragon/shared";

/**
 * The sponsor pilot and renewal pack (S75c, Module 22.9) as the database returns it, flattened to rows for the CSV and the PDF so the two files
 * can never differ. Two checks stand between the database and a sponsor: the database refuses a pack with causal wording, and this module
 * runs the same word list again over everything it is about to write (belt and braces: a bug in one place does not put a claim in a file).
 */
const packReply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), pack: z.record(z.string(), z.unknown()), wording_check: z.object({ passed: z.literal(true) }) }),
  z.object({ ok: z.literal(false), reason: z.string(), hits: z.array(z.string()).optional() }),
]);
export type PackReply = z.infer<typeof packReply>;
export function parsePackReply(data: unknown): PackReply | null {
  const r = packReply.safeParse(data);
  return r.success ? r.data : null;
}

export interface PackRow { section: string; item: string; value: string }

/** Every leaf of the pack as a row; a withheld figure is written as "withheld", never as a blank or a zero. */
export function packRows(pack: Record<string, unknown>): PackRow[] {
  const rows: PackRow[] = [];
  const walk = (path: string[], v: unknown): void => {
    if (v === null || v === undefined) { rows.push({ section: path[0] ?? "", item: path.slice(1).join("."), value: "withheld" }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk([...path, String(i)], x)); return; }
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk([...path, k], x);
      return;
    }
    rows.push({ section: path[0] ?? "", item: path.slice(1).join(".") || path[0] || "", value: String(v) });
  };
  walk([], pack);
  return rows;
}

/** Throws if any text in the rows claims cause. Run before a file is built. */
export function assertNoCausalWording(rows: readonly PackRow[]): void {
  const hits = causalWordingHits(allStrings(rows.map((r) => r.value)));
  if (hits.length > 0) throw new Error(`causal wording in the pack: ${hits.join(", ")}`);
}

function cell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function packToCsv(rows: readonly PackRow[]): string {
  assertNoCausalWording(rows);
  return ["section,item,value", ...rows.map((r) => [r.section, r.item, r.value].map(cell).join(","))].join("\r\n") + "\r\n";
}
