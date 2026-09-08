import { NextResponse } from "next/server";
import { z } from "zod";
import { CONDITION_KEYS, type MeasurementInput, type PatientContext } from "@tarragon/lifestyle-engine";
import { createBearerClient } from "@/lib/supabase/bearer";
import { ingestMeasurement } from "@/lib/lifestyle/ingest";

/**
 * Mobile equivalent of apps/web/.../patient/lifestyle/actions.ts's
 * logReadingAction. Routed through a server endpoint (not a direct client
 * insert) because ingestMeasurement calls evaluateRedFlags from
 * @tarragon/lifestyle-engine before persisting — the same
 * validate-then-red-flag-then-persist safety contract every other clinical
 * ingestion path in this app uses. Reimplementing that check a second time
 * for mobile would risk the two clients drifting out of sync on exactly the
 * kind of signal (an ED/self-harm-risk mood check-in) this file's own
 * comment says must never be silently missed.
 */
const UNIT: Record<"weight" | "activity_minutes" | "mood", string> = {
  weight: "kg",
  activity_minutes: "min",
  mood: "score",
};

const bodySchema = z.object({
  enrollmentId: z.string().uuid(),
  conditionKey: z.enum(CONDITION_KEYS),
  type: z.enum(["weight", "activity_minutes", "mood"]),
  value: z.coerce.number().finite().optional(),
  strugglingWithFood: z.boolean().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { enrollmentId, conditionKey, type, value, strugglingWithFood } = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const measurement: MeasurementInput =
    type === "mood"
      ? {
          type: "mood",
          valueJson: { scale: value ?? 3, eatingDisorderRisk: strugglingWithFood === true },
          unit: UNIT.mood,
          takenAt: new Date().toISOString(),
          source: "app",
        }
      : {
          type,
          valueNum: value ?? 0,
          unit: UNIT[type],
          takenAt: new Date().toISOString(),
          source: "app",
        };

  const patientContext: PatientContext = {
    isPregnant: false,
    hasEatingDisorderHistory: false,
    highRisk: false,
  };

  const result = await ingestMeasurement({
    db: supabase,
    organisationId: profile.organisation_id,
    patientId: user.id,
    enrollmentId,
    conditionKey,
    patientContext,
    measurement,
  });

  if (!result.ok) {
    return NextResponse.json({ error: `Could not save (${result.reason ?? "error"})` }, { status: 400 });
  }

  if (result.evaluation?.hasFlag) {
    return NextResponse.json({
      success: true,
      message: "Thanks for logging this. Your care team has been notified and a doctor will be in touch.",
    });
  }
  return NextResponse.json({ success: true, message: "Logged. Nice work keeping it up." });
}
