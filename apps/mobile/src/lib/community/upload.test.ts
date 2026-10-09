import {
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_SIDE,
  buildPostUpload,
  createRequestIds,
  hasPicture,
  imageAspectRatio,
  imageSource,
  imageUrl,
  interpretUploadResponse,
  keepsRequestId,
  networkFailure,
  toFormData,
} from "./upload";

const image = { uri: "file:///cache/picture.jpg", width: 1200, height: 900 };
const base = { groupId: "11111111-1111-4111-8111-111111111111", parentId: null, body: "My reading today", clientRequestId: "22222222-2222-4222-8222-222222222222" };

describe("buildPostUpload", () => {
  it("carries the four fields and the picture when the group allows pictures", () => {
    const upload = buildPostUpload({ ...base, image, imagesAllowed: true });
    expect(upload.fields).toEqual([
      ["group_id", base.groupId],
      ["body", base.body],
      ["client_request_id", base.clientRequestId],
    ]);
    expect(upload.image).toEqual({ uri: image.uri, name: "picture.jpg", type: "image/jpeg" });
    expect(hasPicture(upload)).toBe(true);
  });
  it("adds parent_id only for a reply", () => {
    const reply = buildPostUpload({ ...base, parentId: "33333333-3333-4333-8333-333333333333", image, imagesAllowed: true });
    expect(reply.fields).toContainEqual(["parent_id", "33333333-3333-4333-8333-333333333333"]);
    expect(buildPostUpload({ ...base, image, imagesAllowed: true }).fields.map(([k]) => k)).not.toContain("parent_id");
  });
  it("never attaches a picture when the group does not allow pictures, whatever was chosen", () => {
    const upload = buildPostUpload({ ...base, image, imagesAllowed: false });
    expect(upload.image).toBeNull();
    expect(hasPicture(upload)).toBe(false);
  });
  it("has no picture when none was chosen", () => {
    expect(buildPostUpload({ ...base, image: null, imagesAllowed: true }).image).toBeNull();
  });
  it("builds a multipart body with the picture under the name the server reads", () => {
    const withPicture = toFormData(buildPostUpload({ ...base, image, imagesAllowed: true }));
    expect(withPicture.get("group_id")).toBe(base.groupId);
    expect(withPicture.get("body")).toBe(base.body);
    expect(withPicture.get("client_request_id")).toBe(base.clientRequestId);
    // (The test runtime's FormData stringifies a file object; on the phone React Native reads the uri, name and type.)
    expect(withPicture.has("image")).toBe(true);
    const without = toFormData(buildPostUpload({ ...base, image, imagesAllowed: false }));
    expect(without.has("image")).toBe(false);
    expect(without.get("body")).toBe(base.body);
  });
  it("fixes the sizes at 1600 px and quality 0.8", () => {
    expect(IMAGE_MAX_SIDE).toBe(1600);
    expect(IMAGE_JPEG_QUALITY).toBe(0.8);
  });
});

describe("interpretUploadResponse (same mapping as the web composeOutcome)", () => {
  it("published, held, blocked, refused and safety", () => {
    expect(interpretUploadResponse(200, { status: "published", post_id: "p" })).toEqual({ kind: "outcome", outcome: { kind: "published", message: "community.compose.published" } });
    expect(interpretUploadResponse(200, { status: "held", reason: "image" })).toEqual({ kind: "outcome", outcome: { kind: "held", message: "community.compose.held.image" } });
    expect(interpretUploadResponse(200, { status: "blocked", reason: "contact" })).toEqual({ kind: "outcome", outcome: { kind: "blocked", message: "community.compose.blocked.contact" } });
    expect(interpretUploadResponse(200, { status: "refused", reason: "images_off" })).toEqual({ kind: "outcome", outcome: { kind: "refused", message: "community.compose.refused.images_off" } });
    expect(interpretUploadResponse(200, { status: "withheld", safety_kind: "emergency" })).toEqual({
      kind: "outcome",
      outcome: { kind: "safety", safety: "emergency", message: "community.safety.emergency.title" },
    });
  });
  it("a bad picture answers 400 with a refusal that is still read as an answer", () => {
    expect(interpretUploadResponse(400, { status: "refused", reason: "bad_image" })).toEqual({
      kind: "outcome",
      outcome: { kind: "refused", message: "community.compose.refused.bad_image" },
    });
  });
  it("a plain error body is a failure: a 4xx is a clear no, a 5xx or a broken body is not", () => {
    expect(interpretUploadResponse(400, { error: "Please check the post and try again." })).toEqual({ kind: "failed", definite: true });
    expect(interpretUploadResponse(401, { error: "Please sign in again." })).toEqual({ kind: "failed", definite: true });
    expect(interpretUploadResponse(502, { error: "x" })).toEqual({ kind: "failed", definite: false });
    expect(interpretUploadResponse(200, null)).toEqual({ kind: "failed", definite: false });
    expect(interpretUploadResponse(200, { status: "queued" })).toEqual({ kind: "failed", definite: false });
  });
});

describe("request ids", () => {
  it("keeps the id after a network failure and after a server error, and drops it after any definite answer", () => {
    expect(keepsRequestId(networkFailure)).toBe(true);
    expect(keepsRequestId({ kind: "failed", definite: false })).toBe(true);
    expect(keepsRequestId({ kind: "failed", definite: true })).toBe(false);
    expect(keepsRequestId(interpretUploadResponse(200, { status: "held" }))).toBe(false);
  });
  it("reuses one id across retries and makes a new one after settle", () => {
    let n = 0;
    const ids = createRequestIds(() => `id-${++n}`);
    expect(ids.current()).toBe("id-1");
    expect(ids.current()).toBe("id-1");
    ids.settle();
    expect(ids.current()).toBe("id-2");
  });
});

describe("pictures on screen", () => {
  it("loads from the community route with the member's bearer token", () => {
    expect(imageUrl("https://app.tarragonhealth.ng/", "abc")).toBe("https://app.tarragonhealth.ng/api/community/images/abc");
    expect(imageSource("https://app.tarragonhealth.ng", "abc def", "tok")).toEqual({
      uri: "https://app.tarragonhealth.ng/api/community/images/abc%20def",
      headers: { Authorization: "Bearer tok" },
    });
  });
  it("keeps the proportions within bounds", () => {
    expect(imageAspectRatio(1600, 1200)).toBeCloseTo(4 / 3);
    expect(imageAspectRatio(4000, 500)).toBe(2);
    expect(imageAspectRatio(500, 4000)).toBe(0.6);
    expect(imageAspectRatio(0, 0)).toBeCloseTo(4 / 3);
  });
});
