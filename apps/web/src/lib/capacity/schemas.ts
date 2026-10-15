import { z } from "zod";

const iso = z.string().min(10);

/** public.intake_gate_overview(): the gate, the modes and the override, for the clinical lead and ops. */
export const gateStatusSchema = z.object({
  open: z.boolean(),
  /** true when the database could not read one of the signals; the numbers below are then zero and mean nothing. */
  unavailable: z.boolean().default(false),
  reasons: z.array(z.string()),
  lead_capacity: z.number(),
  lead_in_use: z.number(),
  lead_free: z.number(),
  min_lead_headroom: z.number(),
  rota_gap_hours: z.number(),
  rota_horizon_hours: z.number(),
  class_breaches: z.array(z.object({ priority_class: z.number(), oldest_open_minutes: z.number(), warn_after_minutes: z.number().nullable() })),
});

export const opsModeRowSchema = z.object({
  id: z.uuid(),
  mode: z.enum(["surge", "pause"]),
  state: z.enum(["requested", "active", "lapsed", "ended", "declined"]),
  reason: z.string(),
  requested_at: iso,
  confirm_by: iso.nullable(),
  started_at: iso.nullable(),
  expires_at: iso.nullable(),
  ended_at: iso.nullable(),
  end_kind: z.enum(["manual", "expired", "unconfirmed", "declined"]).nullable(),
});
export type OpsModeRow = z.infer<typeof opsModeRowSchema>;

export const intakeOverviewSchema = z.object({
  enforced: z.boolean(),
  config_version: z.number().nullable(),
  guard_on: z.boolean(),
  gate: gateStatusSchema,
  surge_active: z.boolean(),
  pause_active: z.boolean(),
  override: z.object({ id: z.uuid(), reason: z.string(), expires_at: iso, created_at: iso }).nullable(),
  modes: z.array(opsModeRowSchema),
  overrides: z.array(z.object({ id: z.uuid(), reason: z.string(), created_at: iso, expires_at: iso, ended_at: iso.nullable() })),
  limits: z.object({
    surge_max_hours: z.number(),
    pause_max_hours: z.number(),
    override_max_hours: z.number(),
    pause_confirm_minutes: z.number(),
    reason_min_chars: z.number(),
  }),
});
export type IntakeOverview = z.infer<typeof intakeOverviewSchema>;

export const opsModeStatusSchema = z.object({ surge: iso.nullable(), pause: iso.nullable() });
export type OpsModeStatus = z.infer<typeof opsModeStatusSchema>;

export const coverOverviewSchema = z.object({
  offers: z.array(
    z.object({
      id: z.uuid(),
      clinician: z.string().nullable(),
      state: z.enum(["offered", "fit_confirmed", "cover_requested"]),
      offered_at: iso,
      responded_at: iso.nullable(),
      overnight_pages: z.number(),
      next_shift_starts_at: iso,
      next_shift_ends_at: iso,
    }),
  ),
  rest_overrides: z.array(z.object({ id: z.uuid(), clinician: z.string().nullable(), valid_from: iso, valid_to: iso, reason: z.string(), granted_at: iso })),
  rest_enforced: z.boolean(),
  rest_hours: z.number(),
});
export type CoverOverview = z.infer<typeof coverOverviewSchema>;

const myCoverOffer = z.object({
  id: z.uuid(),
  state: z.enum(["offered", "fit_confirmed", "cover_requested"]),
  offered_at: iso,
  responded_at: iso.nullable(),
  overnight_pages: z.number(),
  next_shift_starts_at: iso,
  next_shift_ends_at: iso,
});
export type MyCoverOffer = z.infer<typeof myCoverOffer>;

/** public.my_cover_offers(): the caller's offers and the rest period in force (so the page never states a number the configuration does not hold). */
export const myCoverOffersSchema = z.object({ rest_hours: z.number(), rest_enforced: z.boolean(), offers: z.array(myCoverOffer) });
export type MyCoverOffers = z.infer<typeof myCoverOffersSchema>;

const groupRow = z.object({
  group: z.enum(["overall", "clinician", "hour", "route", "device"]),
  key: z.string(),
  label: z.string(),
  sent: z.number(),
  acknowledged: z.number(),
  missed: z.number(),
  within_target: z.number(),
  pct_within_target: z.number().nullable(),
  p50_seconds: z.number().nullable(),
  p95_seconds: z.number().nullable(),
});
export type DrillGroupRow = z.infer<typeof groupRow>;

/** public.fire_drill_report() */
export const fireDrillReportSchema = z.object({
  days: z.number(),
  target_seconds: z.number(),
  target_pct: z.number(),
  pending: z.number(),
  meets_target: z.boolean(),
  groups: z.array(groupRow),
});
export type FireDrillReport = z.infer<typeof fireDrillReportSchema>;

export const GATE_REASON_LABEL: Record<string, string> = {
  lead_headroom: "Few places left with lead clinicians",
  rota_coverage: "The on-call rota has a gap inside the cover window",
  oldest_task: "Clinical work has been waiting longer than its limit",
  unavailable: "The gate could not read one of its signals, so new sales are being refused until it can",
};
