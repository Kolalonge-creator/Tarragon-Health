// The edge function entry points read Deno.env, call Deno.serve and import the client from jsr; the test that covers them stubs
// all three before importing.
declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void };
declare module "jsr:@supabase/supabase-js@2" {
  export function createClient(
    url: string,
    key: string,
    options?: unknown,
  ): { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
}
