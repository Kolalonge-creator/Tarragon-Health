import { z } from "zod";
import { runGateway } from "@/lib/integrations/gateway";

/**
 * Key self-test on the gateway pipeline (§33.2) — the /api/v1 versioned
 * twin of /api/integrations/me and /api/protocol-api/v1/me, kept as its own
 * separate route rather than replacing either: those two have real partners
 * depending on their exact response shape today (see gateway.ts's own
 * "does not replace" note), so /api/v1 is where new integrations land going
 * forward, versioned and gateway-logged from day one.
 */
const emptySchema = z.object({});

export async function GET(request: Request): Promise<Response> {
  return runGateway(request, {
    version: "v1",
    endpoint: "/api/v1/me",
    schema: emptySchema,
    handle: async (_body, { verified, supabase }) => {
      const { data: org } = await supabase
        .from("organisations")
        .select("name")
        .eq("id", verified.organisationId)
        .maybeSingle();

      return {
        status: 200,
        body: {
          ok: true,
          organisation: org?.name ?? null,
          environment: verified.environment,
          scopes: verified.scopes,
        },
      };
    },
  });
}
