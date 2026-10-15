import { getAccessToken, uploadPostWithImage } from "@/lib/community/api";
import { fromUpload, type ComposerResult } from "@/lib/community/compose";
import { buildPostUpload } from "@/lib/community/upload";
import type { PreparedImage } from "@/lib/community/upload";

/**
 * A post or reply with its one picture, through the picture route. Only called when the group allows pictures AND the member chose one
 * (the composer passes no picture otherwise), and buildPostUpload re-checks `imagesAllowed` so a picture can never ride along by mistake.
 * Needs the member's session token; with none, it is a failure that keeps the text and the request id.
 */
export async function uploadPost(args: {
  groupId: string;
  parentId: string | null;
  body: string;
  clientRequestId: string;
  image: PreparedImage;
}): Promise<ComposerResult> {
  const token = await getAccessToken();
  if (!token) return { kind: "failed", message: "community.compose.refused.other", definite: false };
  const upload = buildPostUpload({ ...args, imagesAllowed: true });
  return fromUpload(await uploadPostWithImage(upload, token));
}
