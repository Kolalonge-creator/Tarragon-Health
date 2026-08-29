import type { Database, Json } from "./database.types";

/**
 * Hand-written extension of the generated Supabase types, covering the
 * schema added by the community-agents / screening-events / chronic-offer
 * revenue-architecture migrations (supabase/migrations/20260829*.sql).
 *
 * This file exists because those migrations haven't been run against a real
 * Supabase project yet — there is nothing for `generate_typescript_types` to
 * introspect. Once they are applied to a real project, regenerate
 * database.types.ts the normal way and delete this file (and swap the
 * `AppDatabase` import in the client factories below back to `Database`);
 * everything declared here mirrors that generator's own output shape so the
 * swap is a pure type-check, not a rewrite.
 *
 * Kept as a separate additive file rather than hand-editing
 * database.types.ts directly: `Database` is a `type`, not an `interface`, so
 * TypeScript declaration merging doesn't apply — an intersection type
 * (`AppDatabase = Database & AgentAndScreeningSchemaExtensions`) is the
 * correct mechanism instead. Only NEW keys are declared for `Tables`,
 * `Functions` and `Enums` (object-type intersection unions the key sets for
 * genuinely new tables/functions/enums, and unions the *field* sets for the
 * two existing tables extended with a new nullable column below); `Views`
 * and `CompositeTypes` are deliberately omitted so the intersection never
 * touches them.
 */
export interface AgentAndScreeningSchemaExtensions {
  public: {
    Tables: {
      community_agents: {
        Row: {
          id: string;
          organisation_id: string;
          profile_id: string;
          agent_code: string;
          full_name: string;
          phone: string;
          community_affiliation: string | null;
          status: "active" | "suspended";
          recruited_by: string | null;
          payout_bank_name: string | null;
          payout_account_number: string | null;
          payout_account_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organisation_id: string;
          profile_id: string;
          agent_code: string;
          full_name: string;
          phone: string;
          community_affiliation?: string | null;
          status?: "active" | "suspended";
          recruited_by?: string | null;
          payout_bank_name?: string | null;
          payout_account_number?: string | null;
          payout_account_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<AgentAndScreeningSchemaExtensions["public"]["Tables"]["community_agents"]["Insert"]>;
        Relationships: [];
      };
      agent_commission_rates: {
        Row: {
          source_type: "care_voucher_redeemed" | "video_visit_completed" | "screening_event_registration";
          amount_kobo: number;
          is_enabled: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          source_type: "care_voucher_redeemed" | "video_visit_completed" | "screening_event_registration";
          amount_kobo: number;
          is_enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<AgentAndScreeningSchemaExtensions["public"]["Tables"]["agent_commission_rates"]["Insert"]>;
        Relationships: [];
      };
      agent_commissions: {
        Row: {
          id: string;
          organisation_id: string;
          agent_id: string;
          source_type: "care_voucher_redeemed" | "video_visit_completed" | "screening_event_registration";
          source_id: string;
          amount_kobo: number;
          status: "pending" | "approved" | "paid" | "voided";
          payout_batch_id: string | null;
          earned_at: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      agent_payout_batches: {
        Row: {
          id: string;
          organisation_id: string;
          period_start: string;
          period_end: string;
          status: "open" | "paid";
          total_kobo: number;
          note: string | null;
          paid_at: string | null;
          paid_by: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      screening_events: {
        Row: {
          id: string;
          organisation_id: string;
          organiser_profile_id: string;
          organiser_name: string;
          organiser_phone: string;
          organiser_type:
            | "church"
            | "mosque"
            | "market_association"
            | "alumni_association"
            | "hometown_union"
            | "cooperative_society"
            | "sme"
            | "other";
          panel_bundle_id: string;
          price_per_person_kobo: number;
          headcount_target: number;
          registered_count: number;
          event_date: string;
          location_text: string;
          deposit_kobo: number;
          deposit_paid_at: string | null;
          balance_kobo: number;
          balance_paid_at: string | null;
          organiser_incentive_note: string | null;
          agent_id: string | null;
          status: "proposed" | "deposit_paid" | "confirmed" | "completed" | "cancelled";
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      chronic_programme_offers: {
        Row: {
          id: string;
          organisation_id: string;
          patient_id: string;
          recommendation_id: string | null;
          condition: "hypertension" | "diabetes" | "cardiovascular" | "obesity" | "ckd" | "other";
          recommended_plan_code: string;
          message: string;
          generated_by: string;
          generated_at: string;
          status: "offered" | "accepted" | "declined" | "expired";
          responded_at: string | null;
          subscription_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Existing tables, new nullable columns only (agent attribution).
      care_vouchers: {
        Row: { agent_id: string | null; screening_event_id: string | null };
        Insert: { agent_id?: string | null; screening_event_id?: string | null };
        Update: { agent_id?: string | null; screening_event_id?: string | null };
      };
      video_visit_requests: {
        Row: { agent_id: string | null };
        Insert: { agent_id?: string | null };
        Update: { agent_id?: string | null };
      };
    };
    Functions: {
      admin_create_community_agent: {
        Args: { p_profile_id: string; p_full_name: string; p_phone: string; p_community_affiliation?: string | null };
        Returns: Json;
      };
      admin_create_agent_payout_batch: {
        Args: { p_period_start: string; p_period_end: string };
        Returns: Json;
      };
      admin_mark_payout_batch_paid: {
        Args: { p_batch_id: string; p_note?: string | null };
        Returns: Json;
      };
      admin_create_screening_event: {
        Args: {
          p_organiser_profile_id: string;
          p_organiser_name: string;
          p_organiser_phone: string;
          p_organiser_type:
            | "church"
            | "mosque"
            | "market_association"
            | "alumni_association"
            | "hometown_union"
            | "cooperative_society"
            | "sme"
            | "other";
          p_panel_bundle_id: string;
          p_price_per_person_kobo: number;
          p_headcount_target: number;
          p_event_date: string;
          p_location_text: string;
          p_deposit_kobo?: number;
          p_organiser_incentive_note?: string | null;
          p_agent_code?: string | null;
        };
        Returns: Json;
      };
      admin_record_screening_event_deposit: {
        Args: { p_event_id: string; p_amount_kobo: number };
        Returns: Json;
      };
      admin_record_screening_event_balance: {
        Args: { p_event_id: string; p_amount_kobo: number };
        Returns: Json;
      };
      register_screening_event_participant: {
        Args: { p_event_id: string; p_participant_id: string; p_consent: boolean };
        Returns: Json;
      };
      generate_chronic_programme_offer: {
        Args: {
          p_patient_id: string;
          p_recommendation_id: string | null;
          p_recommended_plan_code: string;
          p_message: string;
        };
        Returns: Json;
      };
      decline_chronic_programme_offer: {
        Args: { p_offer_id: string };
        Returns: Json;
      };
      redeem_care_voucher_assisted: {
        Args: { p_voucher: string; p_beneficiary_phone: string; p_order_type: string; p_order_id: string };
        Returns: Json;
      };
    };
    Enums: {
      agent_status: "active" | "suspended";
      agent_commission_source: "care_voucher_redeemed" | "video_visit_completed" | "screening_event_registration";
      agent_commission_status: "pending" | "approved" | "paid" | "voided";
      screening_event_organiser_type:
        | "church"
        | "mosque"
        | "market_association"
        | "alumni_association"
        | "hometown_union"
        | "cooperative_society"
        | "sme"
        | "other";
      screening_event_status: "proposed" | "deposit_paid" | "confirmed" | "completed" | "cancelled";
      chronic_offer_status: "offered" | "accepted" | "declined" | "expired";
    };
  };
}

/** The type every Supabase client factory in apps/web should use as its
 * generic parameter (see server.ts, client.ts, service-role.ts,
 * middleware.ts) until database.types.ts is regenerated for real. */
export type AppDatabase = Database & AgentAndScreeningSchemaExtensions;

// Convenience row aliases — plain field access, no dependency on the
// generated Tables<>/TablesInsert<>/TablesUpdate<> helpers (those are
// hardcoded against `Database`'s own DefaultSchema and won't see this file).
export type CommunityAgentRow = AgentAndScreeningSchemaExtensions["public"]["Tables"]["community_agents"]["Row"];
export type AgentCommissionRow = AgentAndScreeningSchemaExtensions["public"]["Tables"]["agent_commissions"]["Row"];
export type AgentPayoutBatchRow =
  AgentAndScreeningSchemaExtensions["public"]["Tables"]["agent_payout_batches"]["Row"];
export type ScreeningEventRow = AgentAndScreeningSchemaExtensions["public"]["Tables"]["screening_events"]["Row"];
export type ChronicProgrammeOfferRow =
  AgentAndScreeningSchemaExtensions["public"]["Tables"]["chronic_programme_offers"]["Row"];
