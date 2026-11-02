import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatDb, ConversationStatus } from "./chat-service";
import type { HistoryMessage } from "./types";
import { fdRpcData } from "./raw-db";

/** The chat's database calls, all through the service-role RPCs. Errors become explicit failures: a chat turn is never silently dropped. */
export function createChatDb(supabase: SupabaseClient): ChatDb {
  const call = async <T>(fn: string, args: Record<string, unknown>, opts: { void?: boolean } = {}): Promise<T> => {
    const { data, error } = await fdRpcData<T>(supabase, fn, args);
    // A void function returns no data; any other function returning nothing is a failure, not an empty success.
    if (error || (data === null && !opts.void)) throw new Error(`front desk: ${fn} failed${error ? `: ${error}` : ""}`);
    return data as T;
  };
  return {
    open: (secretHash, page, intro) => call<string>("service_fd_chat_open", { p_secret_hash: secretHash, p_page: page, p_intro: intro }),
    async turn(conversationId, secretHash, text) {
      const r = await call<{ ok: boolean; reason?: string; status?: ConversationStatus; count?: number; history?: HistoryMessage[] }>("service_fd_chat_turn", {
        p_conv: conversationId, p_secret_hash: secretHash, p_text: text,
      });
      if (!r.ok) return { ok: false, reason: (r.reason ?? "not_found") as "not_found" | "closed" | "message_cap" | "invalid_message" };
      return { ok: true, status: r.status ?? "open", count: r.count ?? 0, history: r.history ?? [] };
    },
    async reply(a) {
      await call<null>(
        "service_fd_chat_reply",
        { p_conv: a.conversationId, p_text: a.text, p_model: a.model, p_tokens_in: a.tokensIn, p_tokens_out: a.tokensOut, p_flags: a.flags, p_interaction: a.interactionId, p_answered_by: a.answeredBy },
        { void: true },
      );
    },
    async handoff(a) {
      await call<{ ok: boolean }>("service_fd_chat_handoff", {
        p_conv: a.conversationId, p_reason: a.reason, p_urgency: a.urgency, p_summary: a.summary, p_suggested_reply: a.suggestedReply,
      });
    },
    async usageAdd(model, tokensIn, tokensOut) {
      const { error } = await fdRpcData(supabase, "service_fd_usage_add", { p_model: model, p_tokens_in: tokensIn, p_tokens_out: tokensOut });
      // Spend accounting must not break a reply, but an undercount must not be silent either.
      if (error) console.error("front desk: could not record model usage", error);
    },
    async noteTopic(conversationId, topic) {
      const { error } = await fdRpcData(supabase, "service_fd_chat_note_topic", { p_conv: conversationId, p_topic: topic });
      if (error) throw new Error(`front desk: service_fd_chat_note_topic failed: ${error}`);
    },
    async spendToday() {
      const { data, error } = await fdRpcData<number | string>(supabase, "service_fd_spend_today", {});
      return error || data === null ? null : Number(data);
    },
  };
}
