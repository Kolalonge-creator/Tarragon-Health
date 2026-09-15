/**
 * Minimal ambient types for `node:sqlite`, used only by this directory's
 * expo-sqlite stand-in.
 *
 * The workspace is on @types/node 20, which predates the module (it was
 * added upstream in @types/node 22). Bumping just this package isn't
 * possible in practice — pnpm dedupes @types/node to one version across all
 * nine workspace projects — and bumping it repo-wide to satisfy a test
 * helper would be a much larger change than this. Only the four members the
 * stand-in actually calls are declared; anything else stays a type error
 * rather than being silently `any`.
 */
declare module "node:sqlite" {
  export class StatementSync {
    run(...params: readonly (string | number | null)[]): { changes: number; lastInsertRowid: number };
    all(...params: readonly (string | number | null)[]): unknown[];
    get(...params: readonly (string | number | null)[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
