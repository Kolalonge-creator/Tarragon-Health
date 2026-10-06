import { supabase } from "../supabase";
import { WRITTEN_QUESTION_BUCKET } from "./api";
import { finalRefusalKey, isFinalPhotoRefusal, mapWrittenQuestionError } from "./errors";
import type { QueueRemote } from "./queue";

/** The real network side of the queue. Both database calls are idempotent per client id and path. */
export const supabaseQueueRemote: QueueRemote = {
  async submit(input) {
    try {
      const { data, error } = await supabase.rpc("submit_written_question", {
        p_category: input.category,
        p_question: input.question,
        p_client_id: input.clientId,
        ...(input.durationNote ? { p_duration_note: input.durationNote } : {}),
      });
      if (error || !data) {
        const final = finalRefusalKey(error?.message);
        return {
          ok: false,
          final: final !== null,
          key: final ?? mapWrittenQuestionError(error?.message),
          message: error?.message,
        };
      }
      return { ok: true, id: data };
    } catch (e) {
      return { ok: false, final: false, key: "wq.error.generic", message: e instanceof Error ? e.message : "network" };
    }
  },
  async upload(path, bytes) {
    try {
      const { error } = await supabase.storage
        .from(WRITTEN_QUESTION_BUCKET)
        .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
      if (!error) return { ok: true };
      const detail = error as { message?: string; statusCode?: string | number };
      const exists = /already exists|duplicate/i.test(detail.message ?? "") || String(detail.statusCode) === "409";
      return exists ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  },
  async register(consultId, path, byteCount) {
    try {
      const { error } = await supabase.rpc("attach_written_question_photo", {
        p_consult: consultId,
        p_path: path,
        p_mime: "image/jpeg",
        p_bytes: byteCount,
      });
      if (!error) return { ok: true };
      return { ok: false, dropPhoto: isFinalPhotoRefusal(error.message) };
    } catch {
      return { ok: false, dropPhoto: false };
    }
  },
};
