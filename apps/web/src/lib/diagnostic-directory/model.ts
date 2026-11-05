import { z } from "zod";

/**
 * Diagnostic directory (Phase 2b): shapes of what the admin screens read and send. Every database answer is parsed here; a
 * failed parse is a load failure on screen, never an empty list. The database (admin_dx_* functions) decides who may act and
 * enforces every rule; these schemas only stop obviously malformed forms before a round trip.
 */

export const REGULATORS = ["mlscn_registration", "iso15189", "nnra_authorisation", "state_facility_licence", "rrbn", "mdcn", "other"] as const;
export const CREDENTIAL_STATUSES = [
  "verified_current", "pending", "registered_accreditation_unverified", "accreditation_verified", "scope_partially_verified",
  "expired", "suspended", "withdrawn", "failed", "unverified",
] as const;
export const AVAILABILITY = ["available", "temporarily_unavailable", "by_appointment", "external_referral", "awaiting_confirmation", "discontinued"] as const;
export const PERFORMED = ["onsite", "other_branch_same_provider", "external_facility"] as const;
export const INVESTIGATION_CATEGORIES = [
  "haematology", "clinical_chemistry", "endocrinology", "lipids", "renal", "liver", "microbiology", "serology", "immunology", "molecular",
  "histopathology", "cytology", "tumour_markers", "urinalysis", "reproductive", "infectious_disease", "ultrasound", "breast_imaging", "xray",
  "ct", "mri", "cardiac", "endoscopy", "physiology", "other_imaging",
] as const;
export const LISTING_STATUSES = ["draft", "listed", "suspended", "deactivated"] as const;

export const NOTICES = [
  "facility_created", "listing_started", "branch_added", "branch_added_to_directory", "location_verified", "status_set",
  "service_saved", "credential_recorded", "credential_set", "incident_opened", "incident_closed", "partner_set", "partner_ended",
  "denied", "invalid", "failed", "contracted_branch", "rule_refused", "not_found",
] as const;
export type Notice = (typeof NOTICES)[number];
export const BAD_NOTICES: ReadonlySet<Notice> = new Set(["denied", "invalid", "failed", "contracted_branch", "rule_refused", "not_found"]);
export const asNotice = (v: unknown): Notice | null => (NOTICES as readonly string[]).includes(String(v)) ? (v as Notice) : null;

/** Database error code to a fixed notice. 42501 = not allowed, 22023 = bad input, 23514/23503/23505 = a rule refused it. */
export function noticeForError(code: string | undefined, contractedBranch = false): Notice {
  if (code === "42501") return contractedBranch ? "contracted_branch" : "denied";
  if (code === "22023") return "invalid";
  if (code === "23514" || code === "23503" || code === "23505") return "rule_refused";
  return "failed";
}

const uuid = z.string().uuid();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optText = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();
const optNumber = (min: number, max: number) =>
  z.union([z.literal(""), z.coerce.number().min(min).max(max)]).transform((v) => (v === "" ? null : v)).nullable().optional();
const optDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => (v === "" ? null : v)).nullable().optional();
const phone = z.union([z.literal(""), z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/)]).transform((v) => (v === "" ? null : v)).nullable().optional();
const checkbox = z.union([z.literal("on"), z.literal("true"), z.null(), z.undefined()]).transform((v) => v === "on" || v === "true");

const branchFields = {
  branch_name: text(2, 160),
  state: text(2, 60),
  town: text(2, 80),
  lga: optText(80),
  address: text(5, 300),
  phone,
  latitude: optNumber(-90, 90),
  longitude: optNumber(-180, 180),
};

export const createFacilitySchema = z.object({ kind: z.enum(["lab", "imaging"]), name: text(2, 160), ...branchFields });
export const addBranchSchema = z.object({ listing_id: uuid, ...branchFields });
export const startListingSchema = z.object({ kind: z.enum(["lab", "imaging"]), provider_id: uuid });
export const branchToDirectorySchema = z.object({ listing_id: uuid, location_id: uuid, lga: optText(80), town: optText(80), neighbourhood: optText(80) });
export const verifyLocationSchema = z.object({
  listing_id: uuid, branch_listing_id: uuid, source: text(5, 200), note: text(10, 500), hours_checked: checkbox,
});
export const statusSchema = z.object({
  listing_id: uuid, level: z.enum(["provider", "branch"]), target_id: uuid, status: z.enum(LISTING_STATUSES), reason: text(10, 500),
});
export const serviceSchema = z.object({
  listing_id: uuid,
  branch_listing_id: uuid,
  concept_id: uuid,
  availability: z.enum(AVAILABILITY),
  performed: z.enum(PERFORMED),
  performing_branch_listing_id: z.union([z.literal(""), uuid]).transform((v) => (v === "" ? null : v)).nullable().optional(),
  appointment_required: checkbox,
  preparation_note: optText(1000),
  evidence_source: text(5, 300),
});
export const credentialSchema = z.object({
  listing_id: uuid,
  level: z.enum(["provider", "branch"]),
  target_id: uuid,
  regulator: z.enum(REGULATORS),
  issuer: text(2, 160),
  accreditation_body: optText(160),
  state: optText(60),
  identifier: optText(120),
  scope_concept_ids: z.array(uuid).max(200),
  issued_on: optDate,
  expires_on: optDate,
  source_url: z.union([z.literal(""), z.string().trim().url().regex(/^https?:\/\//)]).transform((v) => (v === "" ? null : v)).nullable().optional(),
});
export const credentialStatusSchema = z.object({
  listing_id: uuid, credential_id: uuid, status: z.enum(CREDENTIAL_STATUSES), note: text(10, 500), next_verify_due: optDate,
});
export const openIncidentSchema = z.object({
  listing_id: uuid,
  level: z.enum(["provider", "branch", "service"]),
  target_id: uuid,
  severity: z.enum(["serious", "routine"]),
  description: text(20, 2000),
  suspends: checkbox,
});
export const closeIncidentSchema = z.object({
  listing_id: uuid, incident_id: uuid, decision: text(10, 1000), corrective_action: optText(1000), reinstate: z.enum(["yes", "no"]),
});

// Preferred Partner (Phase 4, DIR-1). Admin only in the database; a commission needs a legal review reference.
const reqDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const setPartnerSchema = z.object({
  listing_id: uuid,
  branch_listing_id: uuid,
  starts_on: reqDate,
  ends_on: optDate,
  has_commission: z.enum(["yes", "no"]),
  legal_review_reference: optText(200),
  note: text(10, 1000),
}).refine((v) => v.has_commission === "no" || (v.legal_review_reference ?? "").length >= 5, { path: ["legal_review_reference"] });
export const endPartnerSchema = z.object({ listing_id: uuid, partnership_id: uuid, reason: text(10, 500) });

// ---- what the screens read ----------------------------------------------------------------------------------------------
const nullableString = z.string().nullable();
const ref = z.object({ id: uuid, listing_id: uuid.nullable() });

export const overviewSchema = z.object({
  providers: z.array(z.object({
    listing_id: uuid, kind: z.enum(["lab", "imaging"]), name: z.string(), contracted: z.boolean(), directory_status: z.enum(LISTING_STATUSES),
    branches: z.number(), listed_branches: z.number(), services: z.number(), eligible_services: z.number(),
  })),
  unlisted: z.array(z.object({ kind: z.enum(["lab", "imaging"]), provider_id: uuid, name: z.string(), contracted: z.boolean() })),
  queue: z.object({
    credentials_pending: z.array(ref.extend({ regulator: z.string(), identifier: nullableString, recorded_at: z.string() })),
    credentials_expiring: z.array(ref.extend({ regulator: z.string(), identifier: nullableString, expires_on: z.string(), expired: z.boolean() })),
    services_overdue: z.array(ref.extend({ test: z.string(), confirmed_at: z.string() })),
    performer_unknown: z.array(ref.extend({ test: z.string() })),
    incidents_open: z.array(ref.extend({ severity: z.string(), suspends: z.boolean(), opened_at: z.string(), description: z.string() })),
  }),
});
export type Overview = z.infer<typeof overviewSchema>;

const serviceRow = z.object({
  id: uuid, concept_id: uuid, test: z.string(), availability: z.enum(AVAILABILITY), performed: z.enum(PERFORMED),
  performing_branch_listing_id: uuid.nullable(), appointment_required: z.boolean(), evidence_source: z.string(),
  confirmed_at: z.string(), confirmed_by: nullableString, reasons: z.array(z.string()),
});
export const detailSchema = z.object({
  listing_id: uuid,
  kind: z.enum(["lab", "imaging"]),
  provider_id: uuid,
  name: z.string(),
  contracted: z.boolean(),
  directory_status: z.enum(LISTING_STATUSES),
  status_reason: nullableString,
  is_test: z.boolean(),
  branches: z.array(z.object({
    location_id: uuid, branch_listing_id: uuid.nullable(), name: z.string(), state: z.string(), town: nullableString, lga: nullableString,
    neighbourhood: nullableString, address: z.string(), phone: nullableString, latitude: z.number().nullable(), longitude: z.number().nullable(),
    open: z.boolean(), email: nullableString, website: nullableString, directory_status: z.enum(LISTING_STATUSES).nullable(),
    location_verified_at: nullableString, location_verified_by: nullableString, location_source: nullableString,
    services: z.array(serviceRow),
  })),
  credentials: z.array(z.object({
    id: uuid, level: z.enum(["provider", "branch"]), branch_listing_id: uuid.nullable(), regulator: z.string(), issuer: z.string(),
    accreditation_body: nullableString, state: nullableString, identifier: nullableString, scope: z.array(z.string()),
    issued_on: nullableString, expires_on: nullableString, source_url: nullableString, status: z.enum(CREDENTIAL_STATUSES),
    effective_status: z.enum(CREDENTIAL_STATUSES), verified_at: nullableString, verified_by: nullableString, verification_note: nullableString,
  })),
  incidents: z.array(z.object({
    id: uuid, status: z.enum(["open", "closed"]), severity: z.string(), suspends: z.boolean(), description: z.string(),
    branch_listing_id: uuid.nullable(), service_id: uuid.nullable(), opened_at: z.string(), decision: nullableString,
    reinstated: z.boolean().nullable(), closed_at: nullableString,
  })),
  other_branches: z.array(z.object({ branch_listing_id: uuid, label: z.string() })),
  events: z.array(z.object({
    at: z.string(), action: z.string(), subject_table: z.string(), from: nullableString, to: nullableString, note: nullableString, actor: nullableString,
  })),
  today: z.string(),
});
export type Detail = z.infer<typeof detailSchema>;
export type DetailBranch = Detail["branches"][number];

export const investigationOptionsSchema = z.array(z.object({ id: uuid, display: z.string(), investigation_category: z.string() }));
export type InvestigationOption = z.infer<typeof investigationOptionsSchema>[number];

export const partnershipsSchema = z.array(z.object({
  id: uuid, branch_listing_id: uuid, starts_on: z.string(), ends_on: nullableString, has_commission: z.boolean(),
  legal_review_reference: nullableString, note: z.string(), created_at: z.string(), created_by: nullableString,
  ended_at: nullableString, ended_by: nullableString, end_reason: nullableString, in_force: z.boolean(),
}));
export type Partnership = z.infer<typeof partnershipsSchema>[number];
