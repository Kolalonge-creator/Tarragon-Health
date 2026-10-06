// S17: POST /functions/v1/queue-next. The signed-in clinician asks for their next task. The function only forwards the
// caller's own JWT to public.queue_next(), so every rule (eligibility, availability, the atomic claim) is decided in
// the database as that user; nothing here chooses a task. Idempotent: a retry over a dropped connection returns the
// same claim. The reply carries ids and neutral facts only (INV-07); clinical facts open through the audited chart read.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { mapQueueError } from "../_shared/queue/claims.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc("queue_next");
  if (error) {
    const { status, code } = mapQueueError(error.message);
    return Response.json({ error: code }, { status });
  }
  return Response.json(data);
});
