import { supabase } from "./supabase";

/**
 * The mobile app is a separate deployment from the web app, so it hits the
 * platform's device-readings Route Handler over plain HTTPS, authenticated
 * with the mobile session's own JWT — see
 * apps/web/src/app/api/mobile/device-readings/route.ts.
 */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export interface PostDeviceReadingResult {
  success: boolean;
  error?: string;
}

export async function postDeviceReading(payload: Record<string, unknown>): Promise<PostDeviceReadingResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { success: false, error: "Not signed in" };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/mobile/device-readings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as { error?: string };
    if (!response.ok) {
      return { success: false, error: json.error ?? `Request failed (${response.status})` };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Couldn't reach the server — check your connection and try again." };
  }
}
