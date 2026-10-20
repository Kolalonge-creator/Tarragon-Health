import { getProposedConfig } from "@tarragon/shared";

/** The PROPOSED passkey values (`auth.passkey_rules`). Read through the versioned registry, never hard-coded at a call site. */
export type PasskeyRules = {
  add_authorisation_minutes: number;
  start_per_ip_per_5min: number;
  verify_per_ip_per_5min: number;
  label_max_chars: number;
};

export function passkeyRules(): PasskeyRules {
  return getProposedConfig("auth.passkey_rules").value as unknown as PasskeyRules;
}
