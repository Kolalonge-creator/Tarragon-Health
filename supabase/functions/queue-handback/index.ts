// S17: POST /functions/v1/queue-handback { task_id, reason, note? }. Returns a claimed task to the queue with a reason.
// The caller's own JWT goes to public.queue_handback(); the database checks the caller holds the live claim.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { mapQueueError, validateHandback } from "../_shared/queue/claims.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });
  let body: { task_id?: unknown; reason?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const taskId = typeof body.task_id === "string" && UUID.test(body.task_id) ? body.task_id : null;
  const reason = typeof body.reason === "string" ? body.reason : "";
  const note = typeof body.note === "string" ? body.note : null;
  if (!taskId) return Response.json({ error: "bad_request" }, { status: 400 });
  const check = validateHandback(reason, note);
  if (!check.ok) return Response.json({ error: check.error }, { status: 422 });

  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { error } = await client.rpc("queue_handback", { p_task: taskId, p_reason: reason, p_note: note });
  if (error) {
    const { status, code } = mapQueueError(error.message);
    return Response.json({ error: code }, { status });
  }
  return Response.json({ ok: true });
});
