import { z } from "zod";

/**
 * Shared by the admin and doctor "look up a member" screens (founder decision COM-6). Defined here, not in model.ts, so the two screens
 * agree on one set of rules. A name can be looked up only while that member has a recent safety concern in that group; the database
 * enforces who may and when, these helpers only validate input and turn answers into plain English.
 */
export const UNMASK_REASON_MIN = 20;

export const IDENTITY_WARNING =
  "Do not type the member's name, phone number, email or any detail that identifies them in the reason. Say why you need to reach them (for example: a safety review). The reason can be read by other staff.";

export const unmaskCandidatesSchema = z.object({
  items: z.array(
    z.object({
      signal_id: z.string(),
      group_id: z.string(),
      group_name: z.string(),
      author_handle: z.string(),
      kind: z.string(),
      status: z.string(),
      created_at: z.string(),
      body: z.string().nullable().optional(),
    }),
  ),
});
export type UnmaskCandidate = z.infer<typeof unmaskCandidatesSchema>["items"][number];

export const dpoListSchema = z.object({
  dpo: z.array(z.object({ profile_id: z.string(), name: z.string().nullable(), set_at: z.string() })),
});
export type DpoList = z.infer<typeof dpoListSchema>;

export const unmaskInputSchema = z.object({
  group_id: z.string().uuid("Please choose a group."),
  handle: z.string().trim().min(1, "Please enter the community name.").max(80),
  reason: z.string().trim().min(UNMASK_REASON_MIN, `Please write a reason of at least ${UNMASK_REASON_MIN} characters. Say why you need to know who this is.`),
});

export const unmaskReplySchema = z.object({
  status: z.string(),
  reason: z.string().optional(),
  profile_id: z.string().optional(),
  full_name: z.string().nullable().optional(),
});

export type UnmaskResult = { full_name: string | null; profile_id?: string };
export type UnmaskState = { ok: boolean; message: string; result?: UnmaskResult } | undefined;

const KIND_WORDS: Readonly<Record<string, string>> = {
  emergency_language: "A post was held back for wording that may mean an emergency",
  self_harm_language: "A post was held back for wording that may mean self-harm",
  reviewer_concern: "Someone reported that this person may be in danger",
};
export const kindWords = (kind: string): string => (Object.hasOwn(KIND_WORDS, kind) ? KIND_WORDS[kind] : "A safety concern was raised");

const REFUSALS: Readonly<Record<string, string>> = {
  no_safety_signal:
    "There is no recent safety concern about that name in that group, so it cannot be looked up. A name is only looked up while someone may be in danger.",
  reason_too_short: "The reason is too short. Say why you need to know who this is.",
  daily_limit: "You have reached today's limit for this.",
  no_such_member: "No member matches that name in this group.",
};
export const unmaskRefusalText = (reason: string | undefined): string =>
  (reason !== undefined && Object.hasOwn(REFUSALS, reason) ? REFUSALS[reason] : undefined) ?? "That could not be done. Please try again.";

export const UNMASK_NOT_ALLOWED = "This is for doctors, the Chief Medical Officer and admins.";
export const UNMASK_RECORDED =
  "The lookup was recorded with your written reason. The Chief Medical Officer and the data protection officer have been told.";

export interface UnmaskRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/**
 * Runs one lookup. `onError` turns a raised database error into a sentence (raw database text never leaves this function).
 * `includeProfileId` is true only on the admin screen, which has always shown it.
 */
export async function runUnmask(
  client: UnmaskRpcClient,
  input: { group_id: string; handle: string; reason: string },
  onError: (e: { message: string; code?: string }) => string,
  includeProfileId: boolean,
): Promise<UnmaskState> {
  const parsedIn = unmaskInputSchema.safeParse(input);
  if (!parsedIn.success) return { ok: false, message: parsedIn.error.issues[0]?.message || "Please check the form and try again." };
  const { data, error } = await client.rpc("community_admin_unmask", {
    p_group_id: parsedIn.data.group_id,
    p_handle: parsedIn.data.handle,
    p_reason: parsedIn.data.reason,
  });
  if (error) return { ok: false, message: onError(error) };
  const reply = unmaskReplySchema.safeParse(data);
  if (!reply.success) return { ok: false, message: "That could not be done. Please try again." };
  if (reply.data.status === "refused") return { ok: false, message: unmaskRefusalText(reply.data.reason) };
  if (reply.data.status !== "ok" || !reply.data.profile_id) return { ok: false, message: "That could not be done. Please try again." };
  return {
    ok: true,
    message: UNMASK_RECORDED,
    result: includeProfileId ? { profile_id: reply.data.profile_id, full_name: reply.data.full_name ?? null } : { full_name: reply.data.full_name ?? null },
  };
}
