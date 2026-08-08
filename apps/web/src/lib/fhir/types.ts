/**
 * Minimal hand-rolled FHIR R4 types — only the shapes this codebase actually
 * emits or consumes, not a full FHIR type library. Deliberate: pulling in a
 * generic FHIR package would bring hundreds of resource/datatype definitions
 * this platform never touches, for a spec whose full surface we don't
 * implement anyway (see fhir/export/get-export-data.ts's exclusion list and
 * fhir/import/bundle-schema.ts's resourceType allow-list — both are
 * deliberately narrower than "all of FHIR").
 */

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface Identifier {
  system?: string;
  value?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface Attachment {
  contentType?: string;
  url?: string;
  title?: string;
}

/** The subset of resource fields shared by everything we build or parse. */
export interface FhirResourceBase {
  resourceType: string;
  id?: string;
  identifier?: Identifier[];
}

// ---------------------------------------------------------------------------
// Resource shapes this codebase actually builds (export) or reads (import).
// Each carries only the fields we populate/consume — not full R4 coverage.
// ---------------------------------------------------------------------------

export interface PatientResource extends FhirResourceBase {
  resourceType: "Patient";
  name?: { text: string }[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  telecom?: { system: "phone"; value: string }[];
}

export interface ObservationComponent {
  code: CodeableConcept;
  valueQuantity?: Quantity;
  valueString?: string;
}

export interface ObservationResource extends FhirResourceBase {
  resourceType: "Observation";
  status: "final" | "amended" | "entered-in-error" | "unknown";
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  effectiveDateTime?: string;
  valueQuantity?: Quantity;
  valueString?: string;
  component?: ObservationComponent[];
  interpretation?: CodeableConcept[];
}

export interface AllergyIntoleranceResource extends FhirResourceBase {
  resourceType: "AllergyIntolerance";
  clinicalStatus?: CodeableConcept;
  code: CodeableConcept;
  patient: Reference;
  criticality?: "low" | "high" | "unable-to-assess";
  reaction?: { manifestation: CodeableConcept[]; description?: string }[];
  recordedDate?: string;
}

export interface DosageInstruction {
  text?: string;
}

export interface MedicationStatementResource extends FhirResourceBase {
  resourceType: "MedicationStatement";
  status: "active" | "completed" | "stopped" | "unknown";
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  dosage?: DosageInstruction[];
  dateAsserted?: string;
}

export interface ImmunizationResource extends FhirResourceBase {
  resourceType: "Immunization";
  status: "completed" | "not-done" | "entered-in-error";
  vaccineCode: CodeableConcept;
  patient: Reference;
  occurrenceDateTime: string;
  protocolApplied?: { doseNumberPositiveInt: number }[];
  performer?: { actor: Reference }[];
}

export interface CarePlanResource extends FhirResourceBase {
  resourceType: "CarePlan";
  status: "draft" | "active" | "completed" | "revoked" | "unknown";
  category?: CodeableConcept[];
  subject: Reference;
  description?: string;
}

export interface EncounterResource extends FhirResourceBase {
  resourceType: "Encounter";
  status: "finished" | "in-progress" | "unknown";
  class?: Coding;
  subject: Reference;
  period?: Period;
  reasonCode?: CodeableConcept[];
  serviceProvider?: Reference;
}

export interface DocumentReferenceResource extends FhirResourceBase {
  resourceType: "DocumentReference";
  status: "current" | "superseded" | "entered-in-error";
  type?: CodeableConcept;
  subject: Reference;
  date?: string;
  content: { attachment: Attachment }[];
}

export interface BundleEntry<T extends FhirResourceBase = FhirResourceBase> {
  fullUrl?: string;
  resource: T;
}

export interface Bundle {
  resourceType: "Bundle";
  id?: string;
  identifier?: Identifier;
  type: string;
  timestamp?: string;
  entry?: BundleEntry[];
}
