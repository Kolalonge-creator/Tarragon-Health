// The abnormal-result handler refuses a caller that does not present the shared jobs secret. Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { checkJobsSecret } from "./auth.ts";

const SECRET = "s3cret-value-that-is-64-chars-long-0123456789-0123456789-abcdefghij";

Deno.test("the right secret is accepted", () => {
  assertEquals(checkJobsSecret(SECRET, SECRET), "ok");
});

Deno.test("no header, an empty header and a wrong header are all refused", () => {
  assertEquals(checkJobsSecret(null, SECRET), "unauthorised");
  assertEquals(checkJobsSecret("", SECRET), "unauthorised");
  assertEquals(checkJobsSecret("wrong", SECRET), "unauthorised");
  assertEquals(checkJobsSecret(SECRET + "x", SECRET), "unauthorised");
  assertEquals(checkJobsSecret(SECRET.slice(0, -1), SECRET), "unauthorised");
});

Deno.test("an unset or empty edge secret lets nobody in, not even an empty header", () => {
  assertEquals(checkJobsSecret("", undefined), "not_configured");
  assertEquals(checkJobsSecret("", ""), "not_configured");
  assertEquals(checkJobsSecret(SECRET, null), "not_configured");
});

Deno.test("the publishable key the trigger used to send is not a secret and is refused", () => {
  assertEquals(checkJobsSecret("sb_publishable_abcdefghijklmnopqrstuvwxyz", SECRET), "unauthorised");
});
