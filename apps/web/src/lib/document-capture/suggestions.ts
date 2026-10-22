/**
 * Photo capture of a paper health document (S43, spec 2.3): the pure half lives in @tarragon/shared so the phone's confirm screen applies exactly
 * the rules the web does (suggestions are never the record; a rejected reading keeps nothing). This file keeps the old import path working.
 */
export {
  CONFIDENCE_LEVELS,
  DOCUMENT_CAPTURE_TYPES,
  MAX_FIELD_VALUE_LENGTH,
  MAX_SUGGESTED_FIELDS,
  decisionsForRpc,
  fieldDecisionsSchema,
  normaliseSuggestions,
  rawCaptureSchema,
  summariseDecisions,
  toSuggestionPayload,
  type DocumentCaptureType,
  type FieldDecision,
  type NormalisedSuggestions,
  type RawCapture,
  type SuggestedField,
  type SuggestionConfidence,
} from "@tarragon/shared";
