/**
 * The practitioner noun for a specialist_type, because a referral letter
 * addresses a person: "any cardiologist the patient chooses", not "any
 * cardiology". Kept in its own pure module (no @react-pdf/renderer import)
 * so it can be unit-tested directly -- see specialist-noun.test.ts.
 *
 * An unmapped value falls back to a humanised version of the raw enum
 * value, so a new enum member degrades to readable text rather than
 * printing a raw underscored code at a specialist -- but every live
 * specialist_type value should have a real entry here (see
 * specialist-noun.test.ts's completeness assertion against the live enum,
 * the same drift class as packages/shared/src/specialist-type-options.ts).
 */
export const SPECIALIST_NOUN: Record<string, string> = {
  urologist: "urologist",
  oncologist: "oncologist",
  ob_gyn: "OB-GYN",
  cardiology: "cardiologist",
  endocrinology: "endocrinologist",
  nephrology: "nephrologist",
  ophthalmology: "ophthalmologist",
  dietetics: "dietitian",
  podiatry: "podiatrist",
  psychiatry: "psychiatrist",
  psychology: "psychologist",
  genitourinary_medicine: "genitourinary medicine specialist",
  other: "specialist",
};

export function specialistNoun(value: string): string {
  return SPECIALIST_NOUN[value] ?? value.replace(/_/g, " ");
}
