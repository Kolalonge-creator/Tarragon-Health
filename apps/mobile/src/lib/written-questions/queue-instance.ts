import * as Crypto from "expo-crypto";
import { createWrittenQuestionQueue } from "./queue";
import { supabaseQueueRemote } from "./queue-remote";
import { sqliteQueueStore } from "./queue-store";

/** The one app-wide queue (real storage, real network). Tests build their own with fakes. */
export const writtenQuestionQueue = createWrittenQuestionQueue({
  store: sqliteQueueStore,
  remote: supabaseQueueRemote,
  newId: () => Crypto.randomUUID(),
});
