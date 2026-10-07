/**
 * Catalogue keys (in `@tarragon/i18n`) for each credential and quality notice
 * the SQL functions can send. The text itself lives in the catalogue so it can
 * be translated and reviewed; a test checks that every key here exists in
 * English.
 */
export interface MessageKeys {
  readonly title: string;
  readonly body: string;
}

const keys = (stem: string): MessageKeys => ({ title: `${stem}.subject`, body: `${stem}.body` });

// ---------------------------------------------------------------------------
// S15: clinician credentialing
// ---------------------------------------------------------------------------
export const CREDENTIAL_MESSAGE_KEYS = {
  "credential.app_approved": keys("credential.app_approved"),
  "credential.app_active": keys("credential.app_active"),
  "credential.app_rejected": keys("credential.app_rejected"),
  "credential.app_submitted": keys("credential.app_submitted"),
  "credential.renewal_uploaded": keys("credential.renewal_uploaded"),
  "credential.test_attempts_used": keys("credential.test_attempts_used"),
  "credential.suspended": keys("credential.suspended"),
  "credential.suspended_reviewers": keys("credential.suspended_reviewers"),
  "credential.reinstated": keys("credential.reinstated"),
  "credential.renewal_recorded": keys("credential.renewal_recorded"),
  "credential.grace_period": keys("credential.grace_period"),
  "credential.expiry_today": keys("credential.expiry_today"),
  "credential.expiry_soon": keys("credential.expiry_soon"),
  "credential.expiry_plan": keys("credential.expiry_plan"),
  "credential.expiry_reviewers": keys("credential.expiry_reviewers"),
} as const satisfies Readonly<Record<string, MessageKeys>>;

// ---------------------------------------------------------------------------
// S20: quality and safety
// ---------------------------------------------------------------------------
export const QUALITY_MESSAGE_KEYS = {
  "quality.audit_assigned": keys("quality.audit_assigned"),
  "quality.audit_no_reviewer": keys("quality.audit_no_reviewer"),
  "quality.audit_complete": keys("quality.audit_complete"),
  "quality.tier1_met": keys("quality.tier1_met"),
  "quality.handback_review": keys("quality.handback_review"),
  "quality.concern_new": keys("quality.concern_new"),
  "quality.concern_ack": keys("quality.concern_ack"),
  "quality.concern_reply": keys("quality.concern_reply"),
  "quality.concern_closed": keys("quality.concern_closed"),
  "quality.concern_overdue": keys("quality.concern_overdue"),
  "quality.concern_needs_response": keys("quality.concern_needs_response"),
  "quality.audit_overdue": keys("quality.audit_overdue"),
} as const satisfies Readonly<Record<string, MessageKeys>>;
