import { z } from "zod";

const iso = z.string().min(10);
const warnings = z.array(z.string()).default([]);

export const coverStatusSchema = z.object({
  covered_now: z.boolean(),
  current_primary: z.string().nullable(),
  current_backup: z.string().nullable(),
  eligible_on_call_clinicians: z.number(),
  enough_clinicians: z.boolean(),
  horizon_days: z.number(),
  gaps: z.array(z.object({ from: iso, to: iso, kind: z.string() })),
});

export const rotaOverviewSchema = z.object({
  status: coverStatusSchema,
  shifts: z.array(
    z.object({
      id: z.uuid(),
      starts_at: iso,
      ends_at: iso,
      primary_id: z.uuid(),
      primary_name: z.string().nullable(),
      backup_id: z.uuid().nullable(),
      backup_name: z.string().nullable(),
      warnings,
      override_reason: z.string().nullable(),
    }),
  ),
  pending_blocks: z.array(z.object({ id: z.uuid(), clinician_id: z.uuid(), name: z.string().nullable(), starts_at: iso, ends_at: iso })),
  swaps: z.array(z.object({ id: z.uuid(), rota_id: z.uuid(), role: z.string(), state: z.string(), reason: z.string(), from_name: z.string().nullable(), to_name: z.string().nullable() })),
  clinicians: z.array(z.object({ id: z.uuid(), name: z.string().nullable(), employment_type: z.string() })),
});
export type RotaOverview = z.infer<typeof rotaOverviewSchema>;

export const leadOverviewSchema = z.object({
  leads: z.array(z.object({ clinician_id: z.uuid(), name: z.string().nullable(), employment_type: z.string(), cap: z.number(), active: z.number() })),
  unassigned: z.array(z.object({ patient_id: z.uuid(), since: iso })),
  conflicts_open: z.number(),
});
export type LeadOverview = z.infer<typeof leadOverviewSchema>;

export const capacitySchema = z.object({
  capacity: z.number(),
  in_use: z.number(),
  free: z.number(),
  accepting_new_patients: z.boolean(),
  unassigned_patients: z.number(),
});
export type LeadCapacity = z.infer<typeof capacitySchema>;

export const myBlocksSchema = z.array(
  z.object({ id: z.uuid(), kind: z.enum(["queue", "on_call", "bookable_consultations"]), state: z.string(), starts_at: iso, ends_at: iso, minimum_guarantee_eligible: z.boolean() }),
);
export const myRotaSchema = z.array(
  z.object({ id: z.uuid(), starts_at: iso, ends_at: iso, primary_name: z.string().nullable(), backup_name: z.string().nullable(), my_role: z.string().nullable() }),
);
export const colleaguesSchema = z.array(z.object({ clinician_id: z.uuid(), name: z.string().nullable() }));
export const leadSummarySchema = z.object({ lead_patients: z.number(), cap: z.number(), lead_capable: z.boolean() });
export const mySwapsSchema = z.array(
  z.object({ id: z.uuid(), rota_id: z.uuid(), role: z.string(), state: z.string(), reason: z.string(), from_name: z.string().nullable(), to_name: z.string().nullable(), direction: z.enum(["incoming", "outgoing"]), starts_at: iso, ends_at: iso }),
);

export const BLOCK_KIND_LABEL: Record<string, string> = {
  queue: "Working the queue",
  on_call: "On call",
  bookable_consultations: "Bookable consultations",
};
export const GAP_LABEL: Record<string, string> = {
  uncovered: "Nobody on call",
  no_backup: "No backup",
  primary_ineligible: "Primary's licence or cover ends in the shift",
  backup_ineligible: "Backup's licence or cover ends in the shift",
};
