import { isSafeImageUrl } from "./avatar";

// Security audit 2026-11-05 (CodeQL js/xss-through-dom): an avatar URL the person controls only reaches <img src> when
// it is https, blob, an image data URL or a same-site path.
describe("isSafeImageUrl", () => {
  it.each([
    "https://abc.supabase.co/storage/v1/object/public/patient-avatars/u/1.png",
    "/brand/logo.png",
    "blob:https://app.tarragonhealth.ng/1234",
    "data:image/png;base64,AAAA",
  ])("allows %s", (url) => expect(isSafeImageUrl(url)).toBe(true));

  it.each([
    "javascript:alert(1)",
    "http://tracker.example/pixel.gif",
    "//evil.example/x.png",
    "data:text/html,<script>alert(1)</script>",
    "not a url",
  ])("refuses %s", (url) => expect(isSafeImageUrl(url)).toBe(false));
});
