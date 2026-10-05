// The sender's template file reads Deno.env; tests stub it before importing (see support/deno.ts).
declare const Deno: { env: { get(key: string): string | undefined } };
