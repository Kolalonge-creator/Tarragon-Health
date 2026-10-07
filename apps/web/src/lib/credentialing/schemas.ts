import { z } from "zod";

/** Shapes of what the credentialing read functions return. Loose on purpose: only what the screens read is checked. */
const iso = z.string().nullable();

export const refereeSchema = z.looseObject({
  name: z.string().optional(),
  institution: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  relationship: z.string().optional(),
});

export const myApplicationSchema = z
  .looseObject({
    id: z.string(),
    state: z.string(),
    employment_type: z.string(),
    details: z.looseObject({
      mdcn_folio: z.string().nullable(),
      qualification: z.string().nullable(),
      graduation_year: z.number().nullable(),
      nysc_year: z.number().nullable(),
      years_since_house_job: z.number().nullable(),
      specialties: z.array(z.string()),
      languages: z.array(z.string()),
      referees: z.array(refereeSchema),
      conflicts_declaration: z.record(z.string(), z.unknown()).nullable(),
      indemnity_insurer: z.string().nullable(),
      indemnity_policy_number: z.string().nullable(),
      indemnity_expires_at: iso,
    }),
    missing: z.array(z.string()),
    documents: z.array(z.looseObject({ id: z.string(), kind: z.string(), created_at: z.string(), verified: z.boolean() })),
    transitions: z.array(z.looseObject({ to_state: z.string(), created_at: z.string() })),
    modules: z.array(
      z.looseObject({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
        content: z.array(z.looseObject({ type: z.string().optional(), body: z.string().optional() })),
        minutes: z.number(),
        completed: z.boolean(),
      }),
    ),
    test: z.looseObject({
      attempts_used: z.number(),
      attempts_allowed: z.number(),
      open_attempt_id: z.string().nullable(),
      next_allowed_at: iso,
      passed: z.boolean(),
    }),
  })
  .nullable();
export type MyApplication = NonNullable<z.infer<typeof myApplicationSchema>>;

export const queueSchema = z.array(
  z.looseObject({
    id: z.string(),
    state: z.string(),
    employment_type: z.string(),
    applicant_name: z.string().nullable(),
    mdcn_folio: z.string().nullable(),
    folio_flag: z.string().nullable(),
    submitted_at: iso,
    updated_at: z.string(),
    checks_passed: z.number(),
    checks_total: z.number(),
    clinical_staff_id: z.string().nullable(),
  }),
);
export type QueueRow = z.infer<typeof queueSchema>[number];

export const detailSchema = z.looseObject({
  application: z.looseObject({
    id: z.string(),
    state: z.string(),
    profile_id: z.string(),
    employment_type: z.string(),
    mdcn_folio: z.string().nullable(),
    folio_flag: z.string().nullable(),
    qualification: z.string().nullable(),
    graduation_year: z.number().nullable(),
    nysc_year: z.number().nullable(),
    years_since_house_job: z.number().nullable(),
    specialties: z.array(z.string()),
    languages: z.array(z.string()),
    referees: z.array(refereeSchema),
    conflicts_declared_at: iso,
    conflicts_declaration: z.record(z.string(), z.unknown()).nullable(),
    indemnity_insurer: z.string().nullable(),
    indemnity_policy_number: z.string().nullable(),
    indemnity_expires_at: iso,
    licence_expires_at: iso,
    test_extra_attempts: z.number(),
    clinical_staff_id: z.string().nullable(),
    rejected_reason: z.string().nullable(),
  }),
  applicant: z.looseObject({ full_name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), role: z.string() }),
  documents: z.array(
    z.looseObject({
      id: z.string(),
      kind: z.string(),
      mime_type: z.string(),
      size_bytes: z.number(),
      created_at: z.string(),
      verified_at: iso,
      verified_by_name: z.string().nullable(),
      superseded: z.boolean(),
      expires_at: iso,
    }),
  ),
  checks: z.array(
    z.looseObject({
      kind: z.string(),
      result: z.string(),
      performed_at: iso,
      performed_by_name: z.string().nullable(),
      notes: z.string().nullable(),
      details: z.record(z.string(), z.unknown()),
    }),
  ),
  transitions: z.array(
    z.looseObject({ from_state: z.string().nullable(), to_state: z.string(), reason: z.string().nullable(), created_at: z.string(), actor_name: z.string().nullable() }),
  ),
  attempts: z.array(
    z.looseObject({
      attempt_number: z.number(),
      score_percent: z.number().nullable(),
      red_total: z.number().nullable(),
      red_correct: z.number().nullable(),
      passed: z.boolean().nullable(),
      submitted_at: iso,
    }),
  ),
  training: z.looseObject({ completed: z.number(), required: z.number() }),
  staff: z
    .looseObject({
      id: z.string(),
      status: z.string(),
      active: z.boolean(),
      level: z.number().nullable(),
      license_expires_at: iso,
      indemnity_expires_at: iso,
      competencies: z.array(z.string()),
    })
    .nullable(),
  folio_conflict: z.array(z.looseObject({ full_name: z.string(), status: z.string() })),
});
export type ApplicationDetail = z.infer<typeof detailSchema>;

export const expiryOverviewSchema = z.array(
  z.looseObject({
    id: z.string(),
    profile_id: z.string(),
    full_name: z.string(),
    status: z.string(),
    active: z.boolean(),
    employment_type: z.string(),
    level: z.number().nullable(),
    license_expires_at: iso,
    indemnity_expires_at: iso,
    indemnity_required: z.boolean(),
    eligible: z.boolean().nullable(),
    grace: z.array(z.looseObject({ id: z.string(), kind: z.string(), ends_at: z.string(), reason: z.string() })),
    competencies: z.array(z.string()),
    audited_task_count: z.number(),
    renewal_documents: z.array(z.looseObject({ id: z.string(), kind: z.string(), created_at: z.string(), expires_at: iso, verified: z.boolean() })),
  }),
);
export type ExpiryRow = z.infer<typeof expiryOverviewSchema>[number];

export const contentSchema = z.looseObject({
  test_cases: z.array(
    z.looseObject({
      id: z.string(),
      code: z.string(),
      scenario: z.string(),
      options: z.array(z.looseObject({ id: z.string(), text: z.string().optional() })),
      correct_option_id: z.string(),
      is_red: z.boolean(),
      rationale: z.string(),
      status: z.string(),
    }),
  ),
  modules: z.array(
    z.looseObject({
      id: z.string(),
      code: z.string(),
      title: z.string(),
      summary: z.string(),
      content: z.array(z.looseObject({ type: z.string().optional(), body: z.string().optional() })),
      minutes: z.number(),
      status: z.string(),
    }),
  ),
});
export type CredentialingContent = z.infer<typeof contentSchema>;

export const myCredentialStatusSchema = z
  .looseObject({
    clinical_staff_id: z.string(),
    status: z.string(),
    active: z.boolean(),
    level: z.number().nullable(),
    licence_expires_at: iso,
    indemnity_expires_at: iso,
    indemnity_required: z.boolean(),
    licence_in_grace: z.boolean(),
    indemnity_in_grace: z.boolean(),
    audited_task_count: z.number(),
    audit_required_count: z.number(),
    eligible: z.boolean().nullable(),
    blockers: z.array(z.string()),
    competencies: z.array(z.string()),
  })
  .nullable();
export type MyCredentialStatus = NonNullable<z.infer<typeof myCredentialStatusSchema>>;

export const startTestSchema = z.looseObject({
  attempt_id: z.string(),
  attempt_number: z.number(),
  cases: z.array(z.looseObject({ id: z.string(), scenario: z.string(), options: z.array(z.looseObject({ id: z.string(), text: z.string().optional() })) })),
});

export const submitTestSchema = z.looseObject({
  passed: z.boolean(),
  score_percent: z.number(),
  safety_critical_missed: z.number(),
  attempts_left: z.number(),
});
