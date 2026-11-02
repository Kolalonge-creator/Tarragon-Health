import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createChatDb } from "./chat-db";
import type { ChatDeps } from "./chat-service";
import { loadChatConfig } from "./config";
import { loadKnowledge } from "./knowledge";
import { readLiveFacts } from "./live-facts";
import { createReceptionist, createSummariser } from "./receptionist";

/** The production wiring of the chat: the service-role database, the governed model call (AI-023) and the live price facts. */
export function createChatDeps(): ChatDeps {
  const supabase = createServiceRoleClient();
  return {
    db: createChatDb(supabase),
    config: () => loadChatConfig(supabase),
    knowledge: (facts) => loadKnowledge(supabase, facts),
    facts: readLiveFacts,
    receptionist: createReceptionist(supabase),
    summariser: createSummariser(supabase),
  };
}

export { createServiceRoleClient };
