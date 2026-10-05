(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } };
export {};
