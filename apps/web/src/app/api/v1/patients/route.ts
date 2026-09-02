import { z } from "zod";
import { runGateway } from "@/lib/integrations/gateway";

/**
 * GET /api/v1/patients?patient_number=TH-000123 — Patient demographics
 * lookup (spec §33.3 Patient category). Query-string, not a path param,
 * because the gateway's own api_requests.endpoint column must stay a route
 * TEMPLATE (see gateway.ts) — a patient identifier belongs in the query
 * string precisely so it can never leak into the logged endpoint value the
 * way a `/api/v1/patients/[id]` dynamic segment would.
 *
 * §33.7 data minimisation: a partner gets identity + demographics only —
 * never clinical fields (hiv_status/hbv_status/hcv_status, is_pregnant,
 * emergency contacts, etc. all live on the same profiles row but are never
 * selected here). A lab or pharmacy integration needs "who is this
 * patient", not their whole chart.
 */
const querySchema = z.object({});

export async function GET(request: Request): Promise<Response> {
  return runGateway(request, {
    version: "v1",
    endpoint: "/api/v1/patients",
    scope: "patients:read",
    schema: querySchema,
    handle: async (_body, { verified, supabase, request: req }) => {
      const patientNumber = new URL(req.url).searchParams.get("patient_number")?.trim();
      if (!patientNumber || !/^TH-\d{6}$/.test(patientNumber)) {
        return { status: 400, body: { error: "patient_number query param must look like TH-000123" } };
      }

      // Org-scoped exactly like /api/integrations/device-readings: a
      // patient_number outside the key's organisation resolves to a clean
      // 404, never a cross-tenant read.
      const { data: patient } = await supabase
        .from("profiles")
        .select("id, patient_number, full_name, date_of_birth, sex, phone")
        .eq("patient_number", patientNumber)
        .eq("organisation_id", verified.organisationId)
        .eq("role", "patient")
        .maybeSingle();

      if (!patient) {
        return { status: 404, body: { error: "Patient not found in this organisation" } };
      }

      return {
        status: 200,
        body: {
          patient_number: patient.patient_number,
          full_name: patient.full_name,
          date_of_birth: patient.date_of_birth,
          sex: patient.sex,
          phone: patient.phone,
        },
      };
    },
  });
}
