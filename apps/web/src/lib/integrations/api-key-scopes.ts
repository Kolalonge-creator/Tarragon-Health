/**
 * API-key scope catalogue — client-safe (no secrets, no server imports) so
 * the admin issuance UI can render scope choices; the server-only
 * api-key.ts re-exports it for verification.
 */
export const API_KEY_SCOPES = ["device_readings:write", "patients:read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
