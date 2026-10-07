import { z } from "zod";

/** Pilot sign-up invites (admin). The database decides status and who may do what; this parses answers and fixes the vocabulary. */
export const KINDS = ["phone", "email", "code"] as const;
export type InviteKind = (typeof KINDS)[number];

export const inviteRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(KINDS),
  identifier: z.string(),
  label: z.string(),
  uses: z.coerce.number(),
  max_uses: z.coerce.number(),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  status: z.enum(["open", "used", "expired", "revoked"]),
  created_at: z.string(),
});
export type InviteRow = z.infer<typeof inviteRowSchema>;
export const inviteRowsSchema = z.array(inviteRowSchema);

export const NOTICES = ["revoked", "switched", "failed", "denied"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: string | undefined): Notice | null => ((NOTICES as readonly string[]).includes(v ?? "") ? (v as Notice) : null);

export const createFormSchema = z
  .object({
    kind: z.enum(KINDS),
    value: z.string().trim().max(200),
    label: z.string().trim().min(3).max(200),
    maxUses: z.coerce.number().int().min(1).max(1000).default(1),
    days: z.coerce.number().int().min(1).max(365).default(30),
  })
  .refine((v) => v.kind === "code" || v.value.length > 0, { path: ["value"] })
  .refine((v) => v.kind !== "phone" || /^\+[1-9][0-9]{7,14}$/.test(v.value), { path: ["value"] })
  .refine((v) => v.kind !== "email" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.value), { path: ["value"] });

export const createResultSchema = z.object({ id: z.string().uuid(), code: z.string().nullable() });

export type CreateState = { ok?: boolean; error?: string; code?: string } | undefined;
