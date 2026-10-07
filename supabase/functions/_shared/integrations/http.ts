import { fail, ok, type ProviderResult } from "./result.ts";

/** The slice of `fetch` the adapters use. Injected so tests never touch the network and the runtime picks its own. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export interface HttpDeps {
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
}

export interface HttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly headers: Record<string, string>;
  readonly body?: unknown;
  /** A form-encoded body, for vendors that do not take JSON. Used instead of `body`. */
  readonly form?: Readonly<Record<string, string>>;
}

const asObject = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The vendor's own message when it sent one. Truncated by `fail`; never includes request headers or the body we sent. */
function vendorMessage(json: unknown, status: number): string {
  const msg = asObject(json)?.["message"];
  return typeof msg === "string" && msg.length > 0 ? msg : `Vendor request failed with status ${status}`;
}

/** One JSON call with a timeout. Maps every outcome to a ProviderResult; nothing here throws. */
export async function httpJson(deps: HttpDeps, req: HttpRequest): Promise<ProviderResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const res = await deps.fetch(req.url, {
      method: req.method,
      headers: { ...(req.form ? { "Content-Type": "application/x-www-form-urlencoded" } : req.body === undefined ? {} : { "Content-Type": "application/json" }), ...req.headers },
      body: req.form ? new URLSearchParams(req.form).toString() : req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    });
    const raw = await res.text();
    let json: unknown = null;
    let parsed = true;
    try {
      json = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      parsed = false;
    }
    if (res.ok) return parsed ? ok(json) : fail("bad_response", "Vendor sent a reply that is not JSON");
    if (res.status === 401 || res.status === 403) return fail("unauthorized", vendorMessage(json, res.status), false);
    if (res.status === 404) return fail("not_found", vendorMessage(json, res.status), false);
    if (res.status === 409) return fail("conflict", vendorMessage(json, res.status), false);
    if (res.status === 429 || res.status >= 500) return fail("vendor_error", vendorMessage(json, res.status), true);
    return fail("vendor_error", vendorMessage(json, res.status), false);
  } catch (e) {
    const aborted = controller.signal.aborted || (e instanceof Error && e.name === "AbortError");
    return aborted ? fail("timeout", "Vendor did not answer in time") : fail("network", "Could not reach the vendor");
  } finally {
    clearTimeout(timer);
  }
}

export { asObject };
