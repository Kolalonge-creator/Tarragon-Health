import { composeOutcome, parseSubmitResult, type ComposeOutcome } from "./model";

/**
 * The picture-post upload, as pure data (docs/COMMUNITY_SPEC.md, images): the form fields the server route expects, how the answer is
 * turned into what the screen does, how a picture is fetched, and when a retry may reuse its request id. No native module is imported
 * here, so all of it is covered by Jest.
 *
 * Contract: apps/web/src/app/api/community/images/route.ts (POST multipart: group_id, parent_id?, body, client_request_id?, image).
 * The server strips location and camera details from the file itself; the phone only shrinks and re-encodes it.
 */

/** The longest side a picture is sent at, and the JPEG quality. */
export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_JPEG_QUALITY = 0.8;

export interface PreparedImage {
  /** A local file:// uri of the shrunk JPEG. */
  uri: string;
  width: number | null;
  height: number | null;
}

export interface PostUploadInput {
  groupId: string;
  parentId: string | null;
  body: string;
  clientRequestId: string;
  image: PreparedImage | null;
  /** group.images_allowed from the group view. When false, no picture is ever attached, whatever was chosen. */
  imagesAllowed: boolean;
}

export interface UploadFile {
  uri: string;
  name: string;
  type: "image/jpeg";
}

export interface PostUpload {
  fields: ReadonlyArray<readonly [string, string]>;
  image: UploadFile | null;
}

/** What goes in the form. parent_id only for a reply; the picture only when the group allows pictures. */
export function buildPostUpload(input: PostUploadInput): PostUpload {
  const fields: Array<readonly [string, string]> = [["group_id", input.groupId]];
  if (input.parentId) fields.push(["parent_id", input.parentId]);
  fields.push(["body", input.body], ["client_request_id", input.clientRequestId]);
  const image: UploadFile | null = input.imagesAllowed && input.image ? { uri: input.image.uri, name: "picture.jpg", type: "image/jpeg" } : null;
  return { fields, image };
}

/** Whether a given post goes through the picture route at all. */
export function hasPicture(upload: PostUpload): boolean {
  return upload.image !== null;
}

/** The multipart body. React Native reads a file from `{ uri, name, type }` appended as a form value. */
export function toFormData(upload: PostUpload): FormData {
  const form = new FormData();
  for (const [name, value] of upload.fields) form.append(name, value);
  if (upload.image) form.append("image", upload.image as unknown as Blob);
  return form;
}

export type UploadReply =
  | { kind: "outcome"; outcome: ComposeOutcome }
  /** `definite` is true when the server gave a clear no (the post was not made), so the next try is a new attempt. */
  | { kind: "failed"; definite: boolean };

/**
 * Turns the server's HTTP answer into what the screen does. The route answers the same {status, reason} shape as the text route
 * (published, held, blocked, withheld, refused), so the SAME composeOutcome mapping applies. Anything else is a failure: a 4xx is a clear
 * no, a 5xx (or no answer at all, see networkFailure) is "we do not know", and the retry reuses its request id so it cannot double-post.
 */
export function interpretUploadResponse(httpStatus: number, json: unknown): UploadReply {
  const result = parseSubmitResult(json);
  if (result) return { kind: "outcome", outcome: composeOutcome(result) };
  return { kind: "failed", definite: httpStatus >= 400 && httpStatus < 500 };
}

/** The phone could not reach the server at all. The post may or may not have been made, so the request id is kept. */
export const networkFailure: UploadReply = { kind: "failed", definite: false };

/** A retry of the SAME attempt reuses its id; a definite answer ends the attempt. */
export function keepsRequestId(reply: UploadReply): boolean {
  return reply.kind === "failed" && !reply.definite;
}

/** Holds the request id of one post attempt. `current()` makes one if there is none; `settle()` ends the attempt. */
export function createRequestIds(newId: () => string): { current: () => string; settle: () => void } {
  let id: string | null = null;
  return {
    current: () => {
      id ??= newId();
      return id;
    },
    settle: () => {
      id = null;
    },
  };
}

export const IMAGES_PATH = "/api/community/images";

/** The route that sends the bytes of one picture, only to someone the database says may see it. */
export function imageUrl(apiBaseUrl: string, imageId: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${IMAGES_PATH}/${encodeURIComponent(imageId)}`;
}

/** An <Image source>: the picture needs the member's bearer token, because there is no public link to it. */
export function imageSource(apiBaseUrl: string, imageId: string, accessToken: string): { uri: string; headers: { Authorization: string } } {
  return { uri: imageUrl(apiBaseUrl, imageId), headers: { Authorization: `Bearer ${accessToken}` } };
}

/** The picture's shape on screen: keeps its proportions, within sensible bounds so a very tall or wide one does not take over the feed. */
export function imageAspectRatio(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 4 / 3;
  return Math.min(2, Math.max(0.6, width / height));
}
