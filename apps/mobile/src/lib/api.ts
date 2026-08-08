import { supabase } from "./supabase";
import type { HealthSample } from "./healthkit";

/**
 * The mobile app is a separate deployment from the web app, so it hits the
 * platform's Route Handlers over plain HTTPS, authenticated with the mobile
 * session's own JWT — see apps/web/src/app/api/mobile/device-readings/route.ts
 * and apps/web/src/app/api/mobile/health-samples/route.ts.
 */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export interface PostDeviceReadingResult {
  success: boolean;
  error?: string;
}

export async function postDeviceReading(payload: Record<string, unknown>): Promise<PostDeviceReadingResult> {
  const result = await request<Record<string, never>>("/api/mobile/device-readings", "POST", payload);
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export interface HealthSyncCursor {
  cursor: string | null;
  last_synced_at: string | null;
}

/** Where the last Apple Health sync got to, so the app reads a delta rather
 * than re-reading (and re-uploading) the same history every time. */
export async function getHealthSyncCursor(): Promise<HealthSyncCursor | null> {
  const result = await request<HealthSyncCursor>("/api/mobile/health-samples", "GET");
  return result.ok ? result.data : null;
}

export interface PostHealthSamplesResult {
  vitals_inserted: number;
  wearable_inserted: number;
  implausible: number;
  cursor: string | null;
}

export async function postHealthSamples(
  samples: HealthSample[]
): Promise<{ ok: true; data: PostHealthSamplesResult } | { ok: false; error: string }> {
  return request<PostHealthSamplesResult>("/api/mobile/health-samples", "POST", { samples });
}

type RequestResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<RequestResult<T>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, error: "Not signed in" };
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      return { ok: false, error: json.error ?? `Request failed (${response.status})` };
    }
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
