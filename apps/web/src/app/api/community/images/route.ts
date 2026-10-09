import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { authenticateCommunity } from "@/lib/community/api-auth";
import { sanitiseImage } from "@/lib/community/image-sanitise";
import { submitResultSchema } from "@/lib/community/model";

/**
 * POST /api/community/images: a post with one picture (multipart form: group_id, parent_id?, body, client_request_id?, image).
 *
 * 1. The file is read from its own bytes, stripped of location and camera details, and size-checked (image-sanitise.ts).
 * 2. It is stored in the private `community-images` bucket under {group}/{random}.{ext} with the service role (no client can write there).
 * 3. The post is created by the database AS THE MEMBER (community_submit_post_with_image): it checks the group allows pictures, runs the
 *    text filters, and always holds the post for a moderator. Nobody but the author and the group's moderators can open the file until
 *    it is approved.
 * 4. If the database did not take the post, or it was a repeat of an earlier request, the file is removed again.
 */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;
const BUCKET = "community-images";

const fieldsSchema = z.object({
  group_id: z.string().uuid(),
  parent_id: z.string().uuid().optional(),
  body: z.string().min(1).max(5000),
  client_request_id: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateCommunity(request);
  if ("response" in auth) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload could not be read." }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File)) return NextResponse.json({ status: "refused", reason: "bad_image" }, { status: 400 });
  if (file.size > HARD_LIMIT_BYTES) return NextResponse.json({ status: "refused", reason: "bad_image" }, { status: 400 });

  const fields = fieldsSchema.safeParse({
    group_id: form.get("group_id"),
    parent_id: form.get("parent_id") || undefined,
    body: form.get("body"),
    client_request_id: form.get("client_request_id") || undefined,
  });
  if (!fields.success) return NextResponse.json({ error: "Please check the post and try again." }, { status: 400 });

  const sanitised = sanitiseImage(new Uint8Array(await file.arrayBuffer()), HARD_LIMIT_BYTES);
  if (!sanitised.ok) return NextResponse.json({ status: "refused", reason: "bad_image" }, { status: 400 });
  const { image } = sanitised;

  const path = `${fields.data.group_id}/${randomUUID()}.${image.ext}`;
  const storage = createServiceRoleClient().storage.from(BUCKET);
  const { error: uploadError } = await storage.upload(path, image.bytes, { contentType: image.mime, upsert: false, cacheControl: "0" });
  if (uploadError) return NextResponse.json({ error: "The picture could not be saved. Please try again." }, { status: 502 });

  const removeFile = async (): Promise<void> => {
    await storage.remove([path]).catch(() => undefined);
  };

  const { data, error } = await auth.supabase.rpc("community_submit_post_with_image", {
    p_group_id: fields.data.group_id,
    p_parent_id: fields.data.parent_id as string,
    p_body: fields.data.body,
    p_client_request_id: fields.data.client_request_id as string,
    p_storage_path: path,
    p_mime: image.mime,
    p_size: image.bytes.length,
    p_width: image.width,
    p_height: image.height,
  });
  if (error) {
    await removeFile();
    return NextResponse.json({ error: "That could not be posted. Please try again." }, { status: 502 });
  }
  const parsed = submitResultSchema.safeParse(data);
  if (!parsed.success) {
    await removeFile();
    return NextResponse.json({ error: "That could not be posted. Please try again." }, { status: 502 });
  }
  // Only a held or withheld post owns the file. Anything else (blocked, refused, a repeat of an earlier request) does not.
  if (!(parsed.data.status === "held" || parsed.data.status === "withheld") || parsed.data.repeat === true) await removeFile();
  return NextResponse.json(parsed.data);
}
