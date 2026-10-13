import type { UnmaskResult } from "@/components/community/unmask-shared";

/** What a form action tells the page. `result` is only ever set by the unmask lookup. */
export type ActionState =
  | { ok: boolean; message: string; result?: UnmaskResult }
  | undefined;
