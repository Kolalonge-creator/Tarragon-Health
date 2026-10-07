import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { parseQuote, type Quote } from "@tarragon/commerce";
import { checkoutReplySchema, hmoReplySchema, parseCatalogue, parseHmoChecks, parseHmoPlans, parseMembership, parseOrders, verifyReplySchema } from "@/lib/commerce/model";

export const commerceKeys = {
  catalogue: ["commerce", "catalogue"] as const,
  orders: ["commerce", "orders"] as const,
  membership: ["commerce", "membership"] as const,
  entitlements: ["commerce", "entitlements"] as const,
};

/** The shop window. Empty while checkout is closed; the database decides, the screen only shows what it is given. */
export function useCatalogue() {
  return useQuery({
    queryKey: commerceKeys.catalogue,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("catalogue");
      if (error) throw error;
      return parseCatalogue(data);
    },
  });
}

/**
 * What the signed-in patient would pay for one item, with the database's own line-by-line explanation (S73). The database computes every
 * number (public.price_quote, the same function create_order uses), so the figure shown is the figure charged. `null` data means "could not
 * be worked out": the screen then falls back to the catalogue price and sends no expected total.
 */
export function useQuote(input: { code: string; beneficiary?: string; discountCode?: string | null; usePoints?: boolean }) {
  return useQuery({
    queryKey: ["commerce", "quote", input.code, input.beneficiary ?? null, input.discountCode ?? null, input.usePoints ?? false] as const,
    queryFn: async (): Promise<Quote | null> => {
      const { data, error } = await createClient().rpc("price_quote", {
        p_code: input.code,
        ...(input.beneficiary ? { p_beneficiary: input.beneficiary } : {}),
        ...(input.discountCode ? { p_discount_code: input.discountCode } : {}),
        ...(input.usePoints ? { p_use_points: true } : {}),
      });
      if (error) throw error;
      return parseQuote(data);
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useMyOrders() {
  return useQuery({
    queryKey: commerceKeys.orders,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_orders");
      if (error) throw error;
      return parseOrders(data);
    },
  });
}

export function useMyMembership() {
  return useQuery({
    queryKey: commerceKeys.membership,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_membership");
      if (error) throw error;
      return parseMembership(data);
    },
  });
}

export type EntitlementRow = {
  id: string;
  kind: string;
  state: string;
  starts_at: string;
  ends_at: string | null;
  remaining_uses: number | null;
  order: { catalog_item: { name_key: string } | null } | null;
};

export function useMyEntitlements() {
  return useQuery({
    queryKey: commerceKeys.entitlements,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("entitlements")
        .select("id, kind, state, starts_at, ends_at, remaining_uses, order:orders!entitlements_order_id_fkey(catalog_item:catalog_items(name_key))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // the select above is exactly EntitlementRow; the embedded relation is typed as a union by the client, so it is narrowed here
      return data as unknown as EntitlementRow[];
    },
  });
}

/** A failed call to an edge function carries the stable error code in its JSON body. */
async function errorCodeOf(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body: unknown = await ctx.clone().json();
      const code = (body as { error?: unknown } | null)?.error;
      if (typeof code === "string") return code;
    } catch {
      // not JSON: fall through to the generic code
    }
  }
  return "unknown";
}

export class CheckoutError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CheckoutError";
  }
}

/**
 * Starts a checkout. `clientKey` is made once per tap by the caller and reused on a retry, so a double tap or a dropped
 * connection returns the same order instead of making a second one. Only the item code is sent, never an amount.
 */
export function useStartCheckout() {
  return useMutation({
    mutationFn: async (input: { code: string; clientKey: string; beneficiary?: string; discountCode?: string; usePoints?: boolean; expectedAmountKobo?: number }) => {
      const body = {
        code: input.code, client_key: input.clientKey, beneficiary: input.beneficiary,
        // S73: the total the person was shown; the database refuses the order if it now computes a different one
        discount_code: input.discountCode, use_points: input.usePoints, expected_amount_kobo: input.expectedAmountKobo,
      };
      const { data, error } = await createClient().functions.invoke("order-checkout", { body });
      if (error) throw new CheckoutError(await errorCodeOf(error));
      const parsed = checkoutReplySchema.safeParse(data);
      if (!parsed.success) throw new CheckoutError("unknown");
      return parsed.data;
    },
  });
}

/** Asks Paystack, through our server, whether an order is paid. Safe to repeat. */
export function useVerifyOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reference: string) => {
      const { data, error } = await createClient().functions.invoke("order-verify", { body: { reference } });
      if (error) throw new CheckoutError(await errorCodeOf(error));
      const parsed = verifyReplySchema.safeParse(data);
      if (!parsed.success) throw new CheckoutError("unknown");
      return parsed.data;
    },
    onSuccess: (reply) => {
      if (reply.state === "paid") void qc.invalidateQueries({ queryKey: ["commerce"] });
    },
  });
}

/** The health plans (HMOs) with a Tarragon programme that this patient can check their membership with (S71, 19.6). */
export function useHmoPlans() {
  return useQuery({
    queryKey: ["commerce", "hmo-plans"] as const,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("available_hmos");
      if (error) throw error;
      return parseHmoPlans(data);
    },
  });
}

/** The patient's own health plan checks. The number is never returned, only the HMO name, the result and the dates. */
export function useMyHmoChecks() {
  return useQuery({
    queryKey: ["commerce", "hmo-checks"] as const,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_hmo_eligibility");
      if (error) throw error;
      return parseHmoChecks(data);
    },
  });
}

/** Asks the hmo-eligibility function to check a member number. The number is sent once, over TLS, and never stored in the clear. */
export function useRequestHmoCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { hmoId: string; memberNumber: string }) => {
      const { data, error } = await createClient().functions.invoke("hmo-eligibility", { body: { hmo_id: input.hmoId, member_number: input.memberNumber } });
      if (error) throw new CheckoutError(await errorCodeOf(error));
      const parsed = hmoReplySchema.safeParse(data);
      if (!parsed.success) throw new CheckoutError("unknown");
      return parsed.data;
    },
    onSuccess: () => {
      // a pass changes the quote for every item, so the quotes are asked again
      void qc.invalidateQueries({ queryKey: ["commerce"] });
    },
  });
}
