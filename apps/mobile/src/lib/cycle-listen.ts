/**
 * UI-A: which recorded clips can be played for a cycle card title. A clip is listed here only once it is recorded AND signed off
 * (the audio manifest decides); none is yet, so no Listen button shows and the words carry every card. Never invent a clip id.
 */
export type CycleListenCard = "status" | "expect" | "danger" | "legend";

export const CYCLE_LISTEN_CLIPS: Partial<Record<CycleListenCard, readonly string[]>> = {};

export function listenClipsFor(card: CycleListenCard): readonly string[] | null {
  const ids = CYCLE_LISTEN_CLIPS[card];
  return ids && ids.length > 0 ? ids : null;
}
