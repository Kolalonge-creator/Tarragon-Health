import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { failsClosedWhenGovernanceUnavailable } from "./system-codes";
import {
  aiRuntimeConfigResponseSchema,
  type AiGovernanceDecision,
  type AiRuntimeConfig,
} from "./types";

/**
 * Reads one AI system's governance record and turns it into a decision the
 * call site can act on (Module 40.17, 40.18).
 *
 * CACHING. Every AI call would otherwise cost an extra round trip, and the
 * answer changes only when a human operates the kill switch. So the config
 * is held in-process for FRESH_MS. The cost of that cache is the worst case
 * that matters here: a system switched off is still answering for up to a
 * minute on any warm server instance. Sixty seconds was chosen as short
 * enough that "we turned it off" is true almost immediately and long enough
 * that a busy coach conversation is not one governance query per turn. It is
 * deliberately not longer.
 *
 * STALE-WHILE-UNAVAILABLE. If the lookup fails and a stale entry is within
 * STALE_MS, that entry is used and the decision is marked `degraded`. This
 * is strictly safer than the alternative for a kill switch: a system a human
 * switched off five minutes ago stays off through a database blip, rather
 * than reverting to the static fail-open/closed default.
 */

const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;

interface CacheEntry {
  readonly config: AiRuntimeConfig | null;
  readonly registered: boolean;
  readonly fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Test seam. Never called from application code. */
export function __clearAiGovernanceCache(): void {
  cache.clear();
}

/**
 * The only part of the Supabase client this package needs. Narrowed to `rpc`
 * on purpose: everything here goes through a SECURITY DEFINER function, so a
 * governance helper that could reach a table directly would be a helper that
 * could bypass the RPC's server-derived organisation and actor.
 */
export type AiGovernanceClient = Pick<SupabaseClient<Database>, "rpc">;

async function fetchConfig(
  supabase: AiGovernanceClient,
  systemCode: string
): Promise<CacheEntry> {
  const { data, error } = await supabase.rpc("ai_runtime_config", {
    p_system_code: systemCode,
  });

  if (error) {
    throw new Error(`ai_runtime_config(${systemCode}) failed: ${error.message}`);
  }

  const parsed = aiRuntimeConfigResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `ai_runtime_config(${systemCode}) returned a shape this build does not understand: ${parsed.error.message}`
    );
  }

  return parsed.data.registered
    ? { config: parsed.data, registered: true, fetchedAt: Date.now() }
    : { config: null, registered: false, fetchedAt: Date.now() };
}

/**
 * The governance decision for one AI system: may this call reach the model,
 * and with what governed configuration.
 *
 * Never throws. A caller that cannot reach governance still gets a decision,
 * because the one thing this function must not do is turn a governance
 * problem into a patient-facing error.
 */
export async function decideAiGovernance(
  supabase: AiGovernanceClient,
  systemCode: string
): Promise<AiGovernanceDecision> {
  const now = Date.now();
  const cached = cache.get(systemCode);

  let entry: CacheEntry | null = cached && now - cached.fetchedAt < FRESH_MS ? cached : null;
  let degraded = false;

  if (!entry) {
    try {
      entry = await fetchConfig(supabase, systemCode);
      cache.set(systemCode, entry);
    } catch (error) {
      console.error("ai-governance: registry lookup failed", { systemCode, error });
      if (cached && now - cached.fetchedAt < STALE_MS) {
        entry = cached;
        degraded = true;
      } else {
        return failsClosedWhenGovernanceUnavailable(systemCode)
          ? {
              allow: false,
              reason: "governance_unavailable",
              config: null,
              message:
                "AI governance could not be read and this system fails closed. The non-AI path runs instead.",
            }
          : { allow: true, config: null, degraded: true };
      }
    }
  }

  if (!entry.registered || !entry.config) {
    return failsClosedWhenGovernanceUnavailable(systemCode)
      ? {
          allow: false,
          reason: "unregistered",
          config: null,
          message: `AI system ${systemCode} is not in the registry. Register it in ai_systems before calling it.`,
        }
      : { allow: true, config: null, degraded: true };
  }

  if (!entry.config.enabled) {
    return {
      allow: false,
      reason: "kill_switch",
      config: entry.config,
      message:
        entry.config.disabled_reason ??
        `${entry.config.name} has been switched off by clinical governance.`,
    };
  }

  return { allow: true, config: entry.config, degraded };
}

/**
 * The governed prompt for a system, or null when none has been activated.
 * A null here means "use the in-repo constant" and never "send no prompt" —
 * see the part-2 migration header for why this path stays fail-soft.
 */
export function governedSystemPrompt(config: AiRuntimeConfig | null): string | null {
  if (!config?.prompt) return null;
  return `${config.prompt.system_prompt}\n\n${config.prompt.safety_instructions}`.trim();
}

/** Rule codes of the guardrails that suppress output rather than warn. */
export function blockingGuardrailCodes(config: AiRuntimeConfig | null): string[] {
  return (config?.guardrails ?? [])
    .filter((g) => g.enforcement === "blocking" || g.enforcement === "escalate")
    .map((g) => g.rule_code);
}
