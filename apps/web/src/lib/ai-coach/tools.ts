import "server-only";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
// @langchain/core@0.3.x's tool() depends on zod@^3.25 internally, and its
// overload generics only resolve cleanly against that exact package identity
// -- the app's own zod (package.json's "zod": "^4.4.3") produces a
// structurally similar but not type-identical ZodObject, which sends
// tool()'s overload resolution to "Type instantiation is excessively deep"
// or a hard `unknown` inference failure. "zod3" is an aliased dependency
// (apps/web/package.json: "zod3": "npm:zod@^3.25.32") pinned to the same
// zod major LangChain itself resolves at runtime -- use it for every tool
// schema in this file; do not swap this back to the bare "zod" import.
import { z } from "zod3";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Read-only record tools for the AI Coach — closes the structural gap
 * docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §4.1 names as the reason the
 * assistant couldn't answer any of §36.4's own example questions ("what is
 * my blood pressure", "when is my next appointment", "what medication am I
 * taking"): there was no tool/function-calling layer anywhere in the
 * codebase, so llmTurn only ever saw a static, pre-fetched context string.
 *
 * HARD INVARIANT: every tool in this file is read-only. No tool defined
 * here may write to any table, ever — that is what keeps the Level 1/
 * Level 4 governance boundary in §1 of the architecture doc structural
 * rather than a matter of prompt discipline. A model that cannot call a
 * write tool cannot create a referral, alter a medication, or otherwise
 * take a clinical action by being talked into it, no matter what the
 * conversation says. If a future need arises for the assistant to write
 * anything, that is new work requiring the same explicit ask CLAUDE.md
 * already requires for the referral pipeline — not an extension of this
 * file.
 *
 * Each tool is bound to one patient/session via closure — `patientId` is
 * never an LLM-supplied argument, so the model has no way to ask for
 * anyone else's record. Every read additionally goes through the caller's
 * own RLS-scoped `supabase` client (never service-role), so even a bug in
 * this file's own patientId scoping would still fail closed at the
 * database layer.
 *
 * Every tool: never throws (a failed lookup returns a short JSON error
 * string the model can see and reason about, e.g. to trigger the §36.13
 * "I don't have enough information" response), and returns a small, typed
 * JSON payload rather than a free-form paragraph, so the model summarises
 * in its own voice rather than parroting raw rows.
 */

function toJson(payload: unknown): string {
  return JSON.stringify(payload);
}

function toolError(toolName: string, error: unknown): string {
  console.error(`ai-coach: ${toolName} tool failed`, error);
  return toJson({ error: `Could not look up this information right now.` });
}

const getVitalsSchema = z.object({
  vitalType: z
    .enum(["blood_pressure", "glucose", "weight", "pulse", "temperature", "spo2"])
    .optional()
    .describe("Restrict to one vital type. Omit to get the most recent readings of any type."),
  limit: z.number().int().min(1).max(20).optional().describe("How many readings to return, most recent first."),
});

const getAppointmentsSchema = z.object({
  includePast: z.boolean().optional().describe("Include past/completed appointments, most recent first."),
});

const getRecentLabResultsSchema = z.object({
  limit: z.number().int().min(1).max(30).optional().describe("How many results to return, most recent first."),
});

const getMedicationInformationSchema = z.object({
  drugName: z.string().min(1).describe("The generic or brand name of the medicine to look up, e.g. 'amlodipine'."),
});

const emptySchema = z.object({});

export function buildPatientRecordTools(supabase: SupabaseClient<Database>, patientId: string) {
  const getVitals = tool(
    async (args: z.infer<typeof getVitalsSchema>) => {
      try {
        const { vitalType, limit } = args;
        let query = supabase
          .from("vitals_readings")
          .select(
            "vital_type, systolic, diastolic, pulse_bpm, glucose_mmol_l, weight_kg, spo2_pct, temperature_c, taken_at"
          )
          .eq("patient_id", patientId);
        if (vitalType) query = query.eq("vital_type", vitalType);
        const { data, error } = await query
          .order("taken_at", { ascending: false })
          .limit(Math.min(Math.max(limit ?? 5, 1), 20));
        if (error) return toolError("getVitals", error);
        if (!data || data.length === 0) {
          return toJson({ readings: [], note: "No readings on file for this patient." });
        }
        return toJson({ readings: data });
      } catch (error) {
        return toolError("getVitals", error);
      }
    },
    {
      name: "getVitals",
      description:
        "Look up the patient's own recorded vitals readings (blood pressure, glucose, weight, pulse, " +
        "temperature, SpO2), most recent first. Optionally filter by vital_type " +
        "('blood_pressure'|'glucose'|'weight'|'pulse'|'temperature'|'spo2') and limit the count (default 5, max 20).",
      schema: getVitalsSchema,
    }
  );

  const getMedications = tool(
    async () => {
      try {
        const { data, error } = await supabase
          .from("medications")
          .select("drug_name, dose, frequency, refill_date, is_active")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(30);
        if (error) return toolError("getMedications", error);
        if (!data || data.length === 0) {
          return toJson({ medications: [], note: "No medications on file for this patient." });
        }
        return toJson({ medications: data });
      } catch (error) {
        return toolError("getMedications", error);
      }
    },
    {
      name: "getMedications",
      description:
        "Look up the patient's own recorded medications, including whether each is currently active. " +
        "This is prescription data only — it does not explain what a drug is for or how it works.",
      schema: emptySchema,
    }
  );

  const getAllergies = tool(
    async () => {
      try {
        const { data, error } = await supabase
          .from("patient_allergies")
          .select("allergen, reaction, severity")
          .eq("patient_id", patientId);
        if (error) return toolError("getAllergies", error);
        if (!data || data.length === 0) {
          return toJson({ allergies: [], note: "No allergies on file for this patient." });
        }
        return toJson({ allergies: data });
      } catch (error) {
        return toolError("getAllergies", error);
      }
    },
    {
      name: "getAllergies",
      description: "Look up the patient's own recorded allergies and reactions.",
      schema: emptySchema,
    }
  );

  const getAppointments = tool(
    async (args: z.infer<typeof getAppointmentsSchema>) => {
      try {
        const { includePast } = args;
        let query = supabase.from("appointments").select("scheduled_for, status, reason").eq("patient_id", patientId);
        if (!includePast) {
          query = query.gte("scheduled_for", new Date().toISOString()).eq("status", "scheduled");
        }
        const { data, error } = await query.order("scheduled_for", { ascending: !includePast }).limit(10);
        if (error) return toolError("getAppointments", error);
        if (!data || data.length === 0) {
          return toJson({ appointments: [], note: "No appointments found." });
        }
        return toJson({ appointments: data });
      } catch (error) {
        return toolError("getAppointments", error);
      }
    },
    {
      name: "getAppointments",
      description:
        "Look up the patient's own appointments. By default returns only upcoming, scheduled appointments, " +
        "soonest first. Pass includePast=true to also see recent past appointments.",
      schema: getAppointmentsSchema,
    }
  );

  const getConditions = tool(
    async () => {
      try {
        const { data, error } = await supabase
          .from("patient_conditions")
          .select("condition_name, status, date_identified")
          .eq("patient_id", patientId)
          .order("date_identified", { ascending: false })
          .limit(20);
        if (error) return toolError("getConditions", error);
        if (!data || data.length === 0) {
          return toJson({ conditions: [], note: "No diagnosed conditions on file for this patient." });
        }
        return toJson({ conditions: data });
      } catch (error) {
        return toolError("getConditions", error);
      }
    },
    {
      name: "getConditions",
      description: "Look up the patient's own diagnosed conditions and their clinical status.",
      schema: emptySchema,
    }
  );

  const getRecentLabResults = tool(
    async (args: z.infer<typeof getRecentLabResultsSchema>) => {
      try {
        const { limit } = args;
        const { data, error } = await supabase
          .from("lab_analyte_readings")
          .select("code, value, unit, taken_at")
          .eq("patient_id", patientId)
          .order("taken_at", { ascending: false })
          .limit(Math.min(Math.max(limit ?? 10, 1), 30));
        if (error) return toolError("getRecentLabResults", error);
        if (!data || data.length === 0) {
          return toJson({ results: [], note: "No lab results on file for this patient." });
        }
        return toJson({ results: data });
      } catch (error) {
        return toolError("getRecentLabResults", error);
      }
    },
    {
      name: "getRecentLabResults",
      description:
        "Look up the patient's own recent lab analyte results (e.g. HbA1c, lipid panel components), most recent first.",
      schema: getRecentLabResultsSchema,
    }
  );

  // Unlike the six tools above, this one reads a shared reviewed-content
  // library (health_education_content), not per-patient data -- there is no
  // patientId scoping to apply here, only the same clinician_reviewed=true
  // gate every other retrieval path in this codebase already applies (see
  // migration 20260829112000_medication_information_drafts.sql). Read-only,
  // same as every other tool in this file -- closes §36.7, which previously
  // had no approved source to answer from at all.
  const getMedicationInformation = tool(
    async (args: z.infer<typeof getMedicationInformationSchema>) => {
      try {
        const { drugName } = args;
        const { data, error } = await supabase
          .from("health_education_content")
          .select("title, summary, body")
          .eq("category", "medicines")
          .eq("clinician_reviewed", true)
          .eq("is_active", true)
          .ilike("title", `%${drugName}%`)
          .limit(1)
          .maybeSingle();
        if (error) return toolError("getMedicationInformation", error);
        if (!data) {
          return toJson({
            found: false,
            note: `No clinician-reviewed information is available yet for "${drugName}".`,
          });
        }
        return toJson({ found: true, title: data.title, summary: data.summary, body: data.body });
      } catch (error) {
        return toolError("getMedicationInformation", error);
      }
    },
    {
      name: "getMedicationInformation",
      description:
        "Look up clinician-reviewed information about what a specific medicine is generally for and how it " +
        "works, by name. Returns found=false if nothing reviewed exists yet for that drug -- treat that the " +
        "same as any other 'no information available' result, never fill the gap from general knowledge.",
      schema: getMedicationInformationSchema,
    }
  );

  const tools: StructuredToolInterface[] = [
    getVitals,
    getMedications,
    getAllergies,
    getAppointments,
    getConditions,
    getRecentLabResults,
    getMedicationInformation,
  ];
  return tools;
}
