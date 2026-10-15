import { z } from "zod";
import { buildCyclePatternReport, type CyclePatternReport, type PatternLogDay } from "@tarragon/shared";
import type { ReproductiveLifeStage } from "@/lib/rules/cycle-prediction";

/**
 * Reads the clinician cycle pattern report through the audited database function (S66, INV-10 and INV-12) and turns the rows into the
 * report with the one shared engine. Each outcome is its own case: a refusal, a feature that is not open yet, and a failed read are never
 * shown as "no cycle data", because a clinician who reads "nothing logged" for a read that failed makes a wrong decision.
 */

/** The slice of the Supabase client this needs, so a test can pass a fake. */
export interface RpcClient {
  rpc(fn: "read_reproductive_pattern_report_audited", args: { p_patient: string; p_reason: string }): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export const PATTERN_REPORT_READ_REASON = "Clinician opened the cycle pattern report";

const flow = z.enum(["none", "spotting", "light", "medium", "heavy", "flooding"]);
const replySchema = z.object({
  status: z.enum(["ok", "denied"]),
  window_months: z.number().optional(),
  life_stage: z.string().optional(),
  cycles: z.array(z.object({ period_start_date: z.string(), period_end_date: z.string().nullable() })),
  logs: z.array(z.object({ log_date: z.string(), flow: flow.nullable(), symptoms: z.array(z.string()), moods: z.array(z.string()) })),
  menopause_logs: z.array(
    z.object({ logged_at: z.string(), symptom_types: z.array(z.string()), severity: z.number().nullable(), postmenopausal_bleeding: z.boolean() }),
  ),
});

export interface MenopauseEntry {
  loggedAt: string;
  symptoms: string[];
  severity: number | null;
  bleeding: boolean;
}

export type PatternReportOutcome =
  | { kind: "ok"; report: CyclePatternReport; menopause: MenopauseEntry[]; windowMonths: number }
  | { kind: "denied" }
  | { kind: "not_open" }
  | { kind: "error" };

const LIFE_STAGES: readonly string[] = ["menstruating", "trying_to_conceive", "pregnant", "postpartum", "perimenopausal", "menopausal", "not_applicable"];

export async function loadCyclePatternReport(client: RpcClient, patientId: string, today: string): Promise<PatternReportOutcome> {
  const { data, error } = await client.rpc("read_reproductive_pattern_report_audited", { p_patient: patientId, p_reason: PATTERN_REPORT_READ_REASON });
  if (error) {
    return error.message?.includes("reproductive_content_guard_off") ? { kind: "not_open" } : { kind: "error" };
  }
  const parsed = replySchema.safeParse(data);
  if (!parsed.success) return { kind: "error" };
  if (parsed.data.status === "denied") return { kind: "denied" };
  const windowMonths = parsed.data.window_months ?? 12;
  const lifeStage = (LIFE_STAGES.includes(parsed.data.life_stage ?? "") ? parsed.data.life_stage : "menstruating") as ReproductiveLifeStage;
  const logs: PatternLogDay[] = parsed.data.logs.map((l) => ({ date: l.log_date, flow: l.flow, symptoms: l.symptoms, moods: l.moods }));
  const report = buildCyclePatternReport({
    periods: parsed.data.cycles.map((c) => ({ startDate: c.period_start_date, endDate: c.period_end_date })),
    logs,
    today,
    lifeStage,
    windowMonths,
  });
  return {
    kind: "ok",
    report,
    windowMonths,
    menopause: parsed.data.menopause_logs.map((m) => ({ loggedAt: m.logged_at, symptoms: m.symptom_types, severity: m.severity, bleeding: m.postmenopausal_bleeding })),
  };
}
