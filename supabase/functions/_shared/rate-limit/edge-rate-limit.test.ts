import { edgeRateLimited, type EdgeRpc } from "./edge-rate-limit.ts";

const rpcReturning = (data: unknown, error: { message: string } | null = null): EdgeRpc => () => Promise.resolve({ data, error });

Deno.test("allowed request passes", async () => {
  if ((await edgeRateLimited(rpcReturning({ allowed: true, limit: 20, remaining: 19 }), "order-checkout")) !== null) throw new Error("should pass");
});

Deno.test("over the limit gives 429 with Retry-After", async () => {
  const r = await edgeRateLimited(rpcReturning({ allowed: false, limit: 20, retry_after_seconds: 17 }), "order-checkout");
  if (!r || r.status !== 429 || r.headers.get("Retry-After") !== "17") throw new Error("expected 429 with Retry-After 17");
});

Deno.test("asks the database for the named bucket", async () => {
  let seen: { fn: string; args: Record<string, unknown> } | null = null;
  await edgeRateLimited((fn, args) => { seen = { fn, args }; return Promise.resolve({ data: { allowed: true }, error: null }); }, "queue-next");
  const s = seen as { fn: string; args: Record<string, unknown> } | null;
  if (!s || s.fn !== "edge_rate_limit_hit" || s.args["p_bucket"] !== "queue-next") throw new Error("wrong rpc call");
});

Deno.test("a limiter that hangs fails open after the timeout", async () => {
  const hang: EdgeRpc = () => new Promise(() => {});
  if ((await edgeRateLimited(hang, "order-checkout", 20)) !== null) throw new Error("a hung limiter must not block");
});

Deno.test("fails open on an rpc error, a throw, and an unexpected answer", async () => {
  if ((await edgeRateLimited(rpcReturning(null, { message: "boom" }), "order-verify")) !== null) throw new Error("error must fail open");
  if ((await edgeRateLimited(() => { throw new Error("down"); }, "order-verify")) !== null) throw new Error("throw must fail open");
  if ((await edgeRateLimited(rpcReturning("weird"), "order-verify")) !== null) throw new Error("odd answer must fail open");
  // an unauthorised / unknown-bucket answer has no retry time: it is not a rate limit
  if ((await edgeRateLimited(rpcReturning({ allowed: false, error: "unauthorised" }), "order-verify")) !== null) throw new Error("not a rate limit");
});
