import { assertEquals } from "jsr:@std/assert@1";
import { refuseUnlessSender, SENDER_SECRET_HEADER } from "./sender-auth.ts";

const req = (secret?: string) => new Request("https://x.test/send-pending-notifications", { method: "POST", headers: secret === undefined ? {} : { [SENDER_SECRET_HEADER]: secret } });
const verifies = (good: string) => (s: string) => Promise.resolve({ ok: s === good, failed: false });

Deno.test("a request with no secret is refused without asking the database", async () => {
  let asked = false;
  const res = await refuseUnlessSender(req(), () => { asked = true; return Promise.resolve({ ok: true, failed: false }); });
  assertEquals(res?.status, 401);
  assertEquals(asked, false);
});

Deno.test("an empty secret is refused", async () => {
  assertEquals((await refuseUnlessSender(req(""), verifies("s")))?.status, 401);
});

Deno.test("a wrong secret is refused and the right one passes", async () => {
  assertEquals((await refuseUnlessSender(req("wrong"), verifies("s")))?.status, 401);
  assertEquals(await refuseUnlessSender(req("s"), verifies("s")), null);
});

Deno.test("when the database cannot answer the caller is refused (503), never let through", async () => {
  const res = await refuseUnlessSender(req("s"), () => Promise.resolve({ ok: false, failed: true }));
  assertEquals(res?.status, 503);
});

Deno.test("a verifier that claims ok but also failed is still refused", async () => {
  assertEquals((await refuseUnlessSender(req("s"), () => Promise.resolve({ ok: true, failed: true })))?.status, 503);
});
