import { assertEquals } from "jsr:@std/assert@1";
import { describePushError } from "./push-error-text.ts";

const webPushError = (message: string, statusCode: number, body: string) => Object.assign(new Error(message), { statusCode, body });

Deno.test("includes the status and the push service's reason", () => {
  assertEquals(
    describePushError(webPushError("Received unexpected response code", 400, '{"reason":"BadWebPushTopic"}')),
    'Received unexpected response code (HTTP 400: {"reason":"BadWebPushTopic"})',
  );
});

Deno.test("status only when the response had no body", () => {
  assertEquals(describePushError(webPushError("Received unexpected response code", 403, "")), "Received unexpected response code (HTTP 403)");
});

Deno.test("collapses whitespace and caps a long body", () => {
  const out = describePushError(webPushError("x", 413, "a\n\n b ".repeat(200)));
  assertEquals(out.includes("\n"), false);
  assertEquals(out.length <= "x (HTTP 413: )".length + 200, true);
});

Deno.test("a plain error with no status keeps its message", () => {
  assertEquals(describePushError(new Error("boom")), "boom");
  assertEquals(describePushError("weird"), "unknown error");
});
