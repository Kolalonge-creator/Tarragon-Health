export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      activity_log_entries: {
        Row: {
          activity_name: string | null
          created_at: string
          duration_minutes: number | null
          entry_type: Database["public"]["Enums"]["activity_entry_type"]
          id: string
          is_favorite: boolean
          logged_at: string
          logged_on: string
          note: string | null
          organisation_id: string
          patient_id: string
          source: Database["public"]["Enums"]["vital_source"]
          step_count: number | null
        }
        Insert: {
          activity_name?: string | null
          created_at?: string
          duration_minutes?: number | null
          entry_type: Database["public"]["Enums"]["activity_entry_type"]
          id?: string
          is_favorite?: boolean
          logged_at?: string
          logged_on?: string
          note?: string | null
          organisation_id: string
          patient_id: string
          source?: Database["public"]["Enums"]["vital_source"]
          step_count?: number | null
        }
        Update: {
          activity_name?: string | null
          created_at?: string
          duration_minutes?: number | null
          entry_type?: Database["public"]["Enums"]["activity_entry_type"]
          id?: string
          is_favorite?: boolean
          logged_at?: string
          logged_on?: string
          note?: string | null
          organisation_id?: string
          patient_id?: string
          source?: Database["public"]["Enums"]["vital_source"]
          step_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_entries_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      add_ons: {
        Row: {
          code: string
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          derived_from_code: string | null
          description: string | null
          features: string[]
          id: string
          interval: Database["public"]["Enums"]["billing_interval"]
          is_active: boolean
          name: string
          paystack_plan_code: string | null
          price_locked: boolean
          price_minor: number
          restricted_to_plan_code: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          derived_from_code?: string | null
          description?: string | null
          features?: string[]
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          is_active?: boolean
          name: string
          paystack_plan_code?: string | null
          price_locked?: boolean
          price_minor?: number
          restricted_to_plan_code?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          derived_from_code?: string | null
          description?: string | null
          features?: string[]
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          is_active?: boolean
          name?: string
          paystack_plan_code?: string | null
          price_locked?: boolean
          price_minor?: number
          restricted_to_plan_code?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "add_ons_derived_from_code_fkey"
            columns: ["derived_from_code"]
            isOneToOne: false
            referencedRelation: "add_ons"
            referencedColumns: ["code"]
          },
        ]
      }
      ai_coach_access_rules: {
        Row: {
          created_at: string
          daily_limit: number | null
          enabled: boolean
          id: string
          organisation_id: string
          patient_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_limit?: number | null
          enabled?: boolean
          id?: string
          organisation_id: string
          patient_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_limit?: number | null
          enabled?: boolean
          id?: string
          organisation_id?: string
          patient_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_coach_access_rules_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_coach_access_rules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          organisation_id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          organisation_id: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          organisation_id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_health_checks: {
        Row: {
          completion_pct: number
          created_at: string
          gender_screens_completed: Json
          id: string
          lab_order_id: string | null
          organisation_id: string
          patient_id: string
          review_summary: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["annual_check_status"]
          tests_completed: Json
          total_cost_kobo: number
          updated_at: string
          year: number
        }
        Insert: {
          completion_pct?: number
          created_at?: string
          gender_screens_completed?: Json
          id?: string
          lab_order_id?: string | null
          organisation_id: string
          patient_id: string
          review_summary?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["annual_check_status"]
          tests_completed?: Json
          total_cost_kobo?: number
          updated_at?: string
          year: number
        }
        Update: {
          completion_pct?: number
          created_at?: string
          gender_screens_completed?: Json
          id?: string
          lab_order_id?: string | null
          organisation_id?: string
          patient_id?: string
          review_summary?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["annual_check_status"]
          tests_completed?: Json
          total_cost_kobo?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_health_checks_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_health_checks_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_health_checks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_health_checks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_health_checks_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_review_workup_catalogue: {
        Row: {
          applies_sex: Database["public"]["Enums"]["sex"] | null
          code: string
          created_at: string
          default_applicable: boolean
          description: string | null
          label: string
          max_age: number | null
          min_age: number | null
          sort_order: number
        }
        Insert: {
          applies_sex?: Database["public"]["Enums"]["sex"] | null
          code: string
          created_at?: string
          default_applicable?: boolean
          description?: string | null
          label: string
          max_age?: number | null
          min_age?: number | null
          sort_order?: number
        }
        Update: {
          applies_sex?: Database["public"]["Enums"]["sex"] | null
          code?: string
          created_at?: string
          default_applicable?: boolean
          description?: string | null
          label?: string
          max_age?: number | null
          min_age?: number | null
          sort_order?: number
        }
        Relationships: []
      }
      annual_review_workup_items: {
        Row: {
          annual_review_id: string
          code: string
          completed_at: string | null
          created_at: string
          id: string
          lab_order_id: string | null
          label: string
          organisation_id: string
          result_summary: string | null
          status: Database["public"]["Enums"]["annual_review_workup_status"]
          updated_at: string
        }
        Insert: {
          annual_review_id: string
          code: string
          completed_at?: string | null
          created_at?: string
          id?: string
          lab_order_id?: string | null
          label: string
          organisation_id: string
          result_summary?: string | null
          status?: Database["public"]["Enums"]["annual_review_workup_status"]
          updated_at?: string
        }
        Update: {
          annual_review_id?: string
          code?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          lab_order_id?: string | null
          label?: string
          organisation_id?: string
          result_summary?: string | null
          status?: Database["public"]["Enums"]["annual_review_workup_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "annual_review_workup_items_annual_review_id_fkey"
            columns: ["annual_review_id"]
            isOneToOne: false
            referencedRelation: "annual_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_review_workup_items_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "annual_review_workup_catalogue"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "annual_review_workup_items_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_review_workup_items_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_review_workup_items_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_reviews: {
        Row: {
          care_plan_updated_at: string | null
          completed_at: string | null
          created_at: string
          current_stage: Database["public"]["Enums"]["annual_review_stage"]
          cycle_year: number
          due_date: string
          id: string
          labs_completed_at: string | null
          medication_review_completed_at: string | null
          notes: string | null
          organisation_id: string
          patient_id: string
          questionnaire_completed_at: string | null
          reviewed_by: string | null
          risk_score_computed_at: string | null
          risk_score_id: string | null
          status: Database["public"]["Enums"]["annual_review_status"]
          updated_at: string
          video_completed_at: string | null
          video_consultation_id: string | null
          year_summary: string | null
        }
        Insert: {
          care_plan_updated_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_stage?: Database["public"]["Enums"]["annual_review_stage"]
          cycle_year: number
          due_date: string
          id?: string
          labs_completed_at?: string | null
          medication_review_completed_at?: string | null
          notes?: string | null
          organisation_id: string
          patient_id: string
          questionnaire_completed_at?: string | null
          reviewed_by?: string | null
          risk_score_computed_at?: string | null
          risk_score_id?: string | null
          status?: Database["public"]["Enums"]["annual_review_status"]
          updated_at?: string
          video_completed_at?: string | null
          video_consultation_id?: string | null
          year_summary?: string | null
        }
        Update: {
          care_plan_updated_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_stage?: Database["public"]["Enums"]["annual_review_stage"]
          cycle_year?: number
          due_date?: string
          id?: string
          labs_completed_at?: string | null
          medication_review_completed_at?: string | null
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          questionnaire_completed_at?: string | null
          reviewed_by?: string | null
          risk_score_computed_at?: string | null
          risk_score_id?: string | null
          status?: Database["public"]["Enums"]["annual_review_status"]
          updated_at?: string
          video_completed_at?: string | null
          video_consultation_id?: string | null
          year_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "annual_reviews_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_reviews_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_reviews_risk_score_id_fkey"
            columns: ["risk_score_id"]
            isOneToOne: false
            referencedRelation: "patient_risk_scores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_reviews_video_consultation_id_fkey"
            columns: ["video_consultation_id"]
            isOneToOne: false
            referencedRelation: "video_consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organisation_id: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organisation_id: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organisation_id?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          clinician_id: string | null
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          reason: string | null
          scheduled_for: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          clinician_id?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          reason?: string | null
          scheduled_for: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          clinician_id?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          reason?: string | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      async_consults: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          category: string
          created_at: string
          duration_note: string | null
          id: string
          organisation_id: string
          patient_id: string
          question: string
          sla_due_at: string
          status: Database["public"]["Enums"]["async_consult_status"]
          updated_at: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          category: string
          created_at?: string
          duration_note?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          question: string
          sla_due_at?: string
          status?: Database["public"]["Enums"]["async_consult_status"]
          updated_at?: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          category?: string
          created_at?: string
          duration_note?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          question?: string
          sla_due_at?: string
          status?: Database["public"]["Enums"]["async_consult_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "async_consults_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "async_consults_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "async_consults_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event: Json
          id: string
          organisation_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event?: Json
          id?: string
          organisation_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event?: Json
          id?: string
          organisation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      bariatric_referrals: {
        Row: {
          bmi: number | null
          created_at: string
          criteria: Json
          eligible: boolean
          id: string
          notes: string | null
          obesity_assessment_id: string | null
          organisation_id: string
          patient_id: string
          referred_at: string
          referred_by: string | null
          specialist_referral_id: string | null
          status: Database["public"]["Enums"]["bariatric_referral_status"]
          updated_at: string
        }
        Insert: {
          bmi?: number | null
          created_at?: string
          criteria?: Json
          eligible?: boolean
          id?: string
          notes?: string | null
          obesity_assessment_id?: string | null
          organisation_id: string
          patient_id: string
          referred_at?: string
          referred_by?: string | null
          specialist_referral_id?: string | null
          status?: Database["public"]["Enums"]["bariatric_referral_status"]
          updated_at?: string
        }
        Update: {
          bmi?: number | null
          created_at?: string
          criteria?: Json
          eligible?: boolean
          id?: string
          notes?: string | null
          obesity_assessment_id?: string | null
          organisation_id?: string
          patient_id?: string
          referred_at?: string
          referred_by?: string | null
          specialist_referral_id?: string | null
          status?: Database["public"]["Enums"]["bariatric_referral_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bariatric_referrals_obesity_assessment_id_fkey"
            columns: ["obesity_assessment_id"]
            isOneToOne: false
            referencedRelation: "obesity_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bariatric_referrals_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bariatric_referrals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bariatric_referrals_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bariatric_referrals_specialist_referral_id_fkey"
            columns: ["specialist_referral_id"]
            isOneToOne: false
            referencedRelation: "specialist_referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_reminder_sends: {
        Row: {
          booking_request_id: string
          milestone_days: number
          sent_at: string
        }
        Insert: {
          booking_request_id: string
          milestone_days: number
          sent_at?: string
        }
        Update: {
          booking_request_id?: string
          milestone_days?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_reminder_sends_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requests: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          notes: string | null
          organisation_id: string
          profile_id: string
          requested_date: string
          service_type: string
          status: Database["public"]["Enums"]["booking_request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          notes?: string | null
          organisation_id: string
          profile_id: string
          requested_date: string
          service_type: string
          status?: Database["public"]["Enums"]["booking_request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          profile_id?: string
          requested_date?: string
          service_type?: string
          status?: Database["public"]["Enums"]["booking_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bp_ladder_steps: {
        Row: {
          created_at: string
          notes: string
          regimen: string
          step: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          notes: string
          regimen: string
          step: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          notes?: string
          regimen?: string
          step?: number
          updated_at?: string
        }
        Relationships: []
      }
      care_access_events: {
        Row: {
          actor_profile_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["care_access_event_kind"]
          metadata: Json
          occurred_at: string
          organisation_id: string
          patient_id: string
          scope: string | null
          subject_profile_id: string | null
        }
        Insert: {
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["care_access_event_kind"]
          metadata?: Json
          occurred_at?: string
          organisation_id: string
          patient_id: string
          scope?: string | null
          subject_profile_id?: string | null
        }
        Update: {
          actor_profile_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["care_access_event_kind"]
          metadata?: Json
          occurred_at?: string
          organisation_id?: string
          patient_id?: string
          scope?: string | null
          subject_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_access_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_access_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_access_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_access_events_subject_profile_id_fkey"
            columns: ["subject_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_access_requests: {
        Row: {
          counterparty_user_id: string
          created_at: string
          id: string
          initiated_by: string
          permission_level: Database["public"]["Enums"]["profile_access_level"]
          profile_id: string
          relationship: string | null
          responded_at: string | null
          responded_by: string | null
          status: Database["public"]["Enums"]["care_access_request_status"]
          updated_at: string
        }
        Insert: {
          counterparty_user_id: string
          created_at?: string
          id?: string
          initiated_by: string
          permission_level: Database["public"]["Enums"]["profile_access_level"]
          profile_id: string
          relationship?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: Database["public"]["Enums"]["care_access_request_status"]
          updated_at?: string
        }
        Update: {
          counterparty_user_id?: string
          created_at?: string
          id?: string
          initiated_by?: string
          permission_level?: Database["public"]["Enums"]["profile_access_level"]
          profile_id?: string
          relationship?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: Database["public"]["Enums"]["care_access_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_access_requests_counterparty_user_id_fkey"
            columns: ["counterparty_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_access_requests_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_access_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_access_requests_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_message_threads: {
        Row: {
          care_plan_id: string | null
          created_at: string
          created_by: string | null
          escalation_id: string | null
          id: string
          last_message_at: string
          organisation_id: string
          patient_id: string
          status: Database["public"]["Enums"]["care_message_thread_status"]
          subject: string
          updated_at: string
        }
        Insert: {
          care_plan_id?: string | null
          created_at?: string
          created_by?: string | null
          escalation_id?: string | null
          id?: string
          last_message_at?: string
          organisation_id: string
          patient_id: string
          status?: Database["public"]["Enums"]["care_message_thread_status"]
          subject: string
          updated_at?: string
        }
        Update: {
          care_plan_id?: string | null
          created_at?: string
          created_by?: string | null
          escalation_id?: string | null
          id?: string
          last_message_at?: string
          organisation_id?: string
          patient_id?: string
          status?: Database["public"]["Enums"]["care_message_thread_status"]
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_message_threads_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_message_threads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_message_threads_escalation_id_fkey"
            columns: ["escalation_id"]
            isOneToOne: false
            referencedRelation: "escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_message_threads_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_message_threads_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_messages: {
        Row: {
          actor_clinical_staff_id: string | null
          author_display: string | null
          author_profile_id: string | null
          author_role: Database["public"]["Enums"]["care_message_author"]
          body: string
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          thread_id: string
        }
        Insert: {
          actor_clinical_staff_id?: string | null
          author_display?: string | null
          author_profile_id?: string | null
          author_role: Database["public"]["Enums"]["care_message_author"]
          body: string
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          thread_id: string
        }
        Update: {
          actor_clinical_staff_id?: string | null
          author_display?: string | null
          author_profile_id?: string | null
          author_role?: Database["public"]["Enums"]["care_message_author"]
          body?: string
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_messages_actor_clinical_staff_id_fkey"
            columns: ["actor_clinical_staff_id"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_messages_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_messages_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "care_message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      care_outreach_contacts: {
        Row: {
          channel: Database["public"]["Enums"]["outreach_contact_channel"]
          contacted_at: string
          contacted_by: string
          created_at: string
          id: string
          note: string
          organisation_id: string
          patient_id: string
          task_id: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["outreach_contact_channel"]
          contacted_at?: string
          contacted_by: string
          created_at?: string
          id?: string
          note: string
          organisation_id: string
          patient_id: string
          task_id?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["outreach_contact_channel"]
          contacted_at?: string
          contacted_by?: string
          created_at?: string
          id?: string
          note?: string
          organisation_id?: string
          patient_id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_outreach_contacts_contacted_by_fkey"
            columns: ["contacted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_outreach_contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_outreach_contacts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_outreach_contacts_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "care_outreach_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      care_outreach_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          id: string
          nudge_sent_at: string | null
          organisation_id: string
          outcome_note: string | null
          patient_id: string
          priority: number
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["outreach_task_status"]
          trigger_detail: Json
          trigger_type: Database["public"]["Enums"]["outreach_trigger_type"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          nudge_sent_at?: string | null
          organisation_id: string
          outcome_note?: string | null
          patient_id: string
          priority?: number
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["outreach_task_status"]
          trigger_detail?: Json
          trigger_type: Database["public"]["Enums"]["outreach_trigger_type"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          nudge_sent_at?: string | null
          organisation_id?: string
          outcome_note?: string | null
          patient_id?: string
          priority?: number
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["outreach_task_status"]
          trigger_detail?: Json
          trigger_type?: Database["public"]["Enums"]["outreach_trigger_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_outreach_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_outreach_tasks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_outreach_tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_outreach_tasks_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_recommendations: {
        Row: {
          care_plan_id: string | null
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          inputs_snapshot: Json
          organisation_id: string
          patient_id: string
          rationale: string
          status: Database["public"]["Enums"]["care_plan_recommendation_status"]
          tier: Database["public"]["Enums"]["risk_level"]
          updated_at: string
        }
        Insert: {
          care_plan_id?: string | null
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          inputs_snapshot?: Json
          organisation_id: string
          patient_id: string
          rationale: string
          status?: Database["public"]["Enums"]["care_plan_recommendation_status"]
          tier?: Database["public"]["Enums"]["risk_level"]
          updated_at?: string
        }
        Update: {
          care_plan_id?: string | null
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          inputs_snapshot?: Json
          organisation_id?: string
          patient_id?: string
          rationale?: string
          status?: Database["public"]["Enums"]["care_plan_recommendation_status"]
          tier?: Database["public"]["Enums"]["risk_level"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_recommendations_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_recommendations_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_recommendations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_recommendations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_review_prompts: {
        Row: {
          actioned_at: string | null
          actioned_by: string | null
          care_plan_id: string | null
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          reason: string
          status: Database["public"]["Enums"]["care_plan_review_prompt_status"]
          trigger_event_type: Database["public"]["Enums"]["care_plan_review_trigger_event"]
          trigger_source_id: string
        }
        Insert: {
          actioned_at?: string | null
          actioned_by?: string | null
          care_plan_id?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          reason: string
          status?: Database["public"]["Enums"]["care_plan_review_prompt_status"]
          trigger_event_type: Database["public"]["Enums"]["care_plan_review_trigger_event"]
          trigger_source_id: string
        }
        Update: {
          actioned_at?: string | null
          actioned_by?: string | null
          care_plan_id?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          reason?: string
          status?: Database["public"]["Enums"]["care_plan_review_prompt_status"]
          trigger_event_type?: Database["public"]["Enums"]["care_plan_review_trigger_event"]
          trigger_source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_review_prompts_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_review_prompts_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_review_prompts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_review_prompts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plans: {
        Row: {
          assigned_clinician_id: string | null
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at: string
          id: string
          multi_condition_notified_at: string | null
          notes: string | null
          organisation_id: string
          patient_condition_id: string | null
          patient_id: string
          status: Database["public"]["Enums"]["care_plan_status"]
          target_ranges: Json
          updated_at: string
        }
        Insert: {
          assigned_clinician_id?: string | null
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          id?: string
          multi_condition_notified_at?: string | null
          notes?: string | null
          organisation_id: string
          patient_condition_id?: string | null
          patient_id: string
          status?: Database["public"]["Enums"]["care_plan_status"]
          target_ranges?: Json
          updated_at?: string
        }
        Update: {
          assigned_clinician_id?: string | null
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          id?: string
          multi_condition_notified_at?: string | null
          notes?: string | null
          organisation_id?: string
          patient_condition_id?: string | null
          patient_id?: string
          status?: Database["public"]["Enums"]["care_plan_status"]
          target_ranges?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plans_assigned_clinician_id_fkey"
            columns: ["assigned_clinician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_patient_condition_id_fkey"
            columns: ["patient_condition_id"]
            isOneToOne: false
            referencedRelation: "patient_conditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_receipt_event_labels: {
        Row: {
          activity_label: string | null
          category: string
          event_type: Database["public"]["Enums"]["timeline_event_type"]
        }
        Insert: {
          activity_label?: string | null
          category: string
          event_type: Database["public"]["Enums"]["timeline_event_type"]
        }
        Update: {
          activity_label?: string | null
          category?: string
          event_type?: Database["public"]["Enums"]["timeline_event_type"]
        }
        Relationships: []
      }
      care_team_assignment: {
        Row: {
          assigned_at: string
          care_coordinator_id: string | null
          clinical_director_id: string | null
          clinician_id: string | null
          id: string
          organisation_id: string
          patient_id: string
        }
        Insert: {
          assigned_at?: string
          care_coordinator_id?: string | null
          clinical_director_id?: string | null
          clinician_id?: string | null
          id?: string
          organisation_id: string
          patient_id: string
        }
        Update: {
          assigned_at?: string
          care_coordinator_id?: string | null
          clinical_director_id?: string | null
          clinician_id?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_team_assignment_care_coordinator_id_fkey"
            columns: ["care_coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_team_assignment_clinical_director_id_fkey"
            columns: ["clinical_director_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_team_assignment_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_team_assignment_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_team_assignment_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_voucher_config: {
        Row: {
          extension_months: number
          id: boolean
          max_extensions: number
          min_instalment_kobo: number
          updated_at: string
          updated_by: string | null
          validity_months: number
        }
        Insert: {
          extension_months?: number
          id?: boolean
          max_extensions?: number
          min_instalment_kobo?: number
          updated_at?: string
          updated_by?: string | null
          validity_months?: number
        }
        Update: {
          extension_months?: number
          id?: boolean
          max_extensions?: number
          min_instalment_kobo?: number
          updated_at?: string
          updated_by?: string | null
          validity_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "care_voucher_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      care_voucher_events: {
        Row: {
          actor_profile_id: string | null
          amount_kobo: number | null
          created_at: string
          event_type: Database["public"]["Enums"]["care_voucher_event_type"]
          id: string
          note: string | null
          organisation_id: string
          voucher_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          amount_kobo?: number | null
          created_at?: string
          event_type: Database["public"]["Enums"]["care_voucher_event_type"]
          id?: string
          note?: string | null
          organisation_id: string
          voucher_id: string
        }
        Update: {
          actor_profile_id?: string | null
          amount_kobo?: number | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["care_voucher_event_type"]
          id?: string
          note?: string | null
          organisation_id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_voucher_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_voucher_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_voucher_events_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "care_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      care_voucher_payments: {
        Row: {
          amount_minor: number
          created_at: string
          credit_kobo: number
          currency: string
          id: string
          organisation_id: string
          payer_profile_id: string
          payment_transaction_id: string | null
          pending_provider_ref: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          status: string
          voucher_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          credit_kobo: number
          currency?: string
          id?: string
          organisation_id: string
          payer_profile_id: string
          payment_transaction_id?: string | null
          pending_provider_ref?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          status?: string
          voucher_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          credit_kobo?: number
          currency?: string
          id?: string
          organisation_id?: string
          payer_profile_id?: string
          payment_transaction_id?: string | null
          pending_provider_ref?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          status?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_voucher_payments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_voucher_payments_payer_profile_id_fkey"
            columns: ["payer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_voucher_payments_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_voucher_payments_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "care_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      care_vouchers: {
        Row: {
          activated_at: string | null
          amount_paid_kobo: number
          beneficiary_profile_id: string
          cancelled_at: string | null
          cancelled_reason: string | null
          created_at: string
          expires_at: string | null
          extension_count: number
          face_value_kobo: number
          gift_message: string | null
          id: string
          kind: Database["public"]["Enums"]["care_voucher_kind"]
          organisation_id: string
          panel_bundle_id: string | null
          purchaser_profile_id: string | null
          redeemed_at: string | null
          redeemed_order_id: string | null
          redeemed_order_type:
            | Database["public"]["Enums"]["commission_type"]
            | null
          sku_code: string | null
          sku_name: string | null
          status: Database["public"]["Enums"]["care_voucher_status"]
          subscription_plan_id: string | null
          updated_at: string
          voucher_number: string
        }
        Insert: {
          activated_at?: string | null
          amount_paid_kobo?: number
          beneficiary_profile_id: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          expires_at?: string | null
          extension_count?: number
          face_value_kobo: number
          gift_message?: string | null
          id?: string
          kind: Database["public"]["Enums"]["care_voucher_kind"]
          organisation_id: string
          panel_bundle_id?: string | null
          purchaser_profile_id?: string | null
          redeemed_at?: string | null
          redeemed_order_id?: string | null
          redeemed_order_type?:
            | Database["public"]["Enums"]["commission_type"]
            | null
          sku_code?: string | null
          sku_name?: string | null
          status?: Database["public"]["Enums"]["care_voucher_status"]
          subscription_plan_id?: string | null
          updated_at?: string
          voucher_number: string
        }
        Update: {
          activated_at?: string | null
          amount_paid_kobo?: number
          beneficiary_profile_id?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          expires_at?: string | null
          extension_count?: number
          face_value_kobo?: number
          gift_message?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["care_voucher_kind"]
          organisation_id?: string
          panel_bundle_id?: string | null
          purchaser_profile_id?: string | null
          redeemed_at?: string | null
          redeemed_order_id?: string | null
          redeemed_order_type?:
            | Database["public"]["Enums"]["commission_type"]
            | null
          sku_code?: string | null
          sku_name?: string | null
          status?: Database["public"]["Enums"]["care_voucher_status"]
          subscription_plan_id?: string | null
          updated_at?: string
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_vouchers_beneficiary_profile_id_fkey"
            columns: ["beneficiary_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_vouchers_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_vouchers_panel_bundle_id_fkey"
            columns: ["panel_bundle_id"]
            isOneToOne: false
            referencedRelation: "panel_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_vouchers_purchaser_profile_id_fkey"
            columns: ["purchaser_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_vouchers_subscription_plan_id_fkey"
            columns: ["subscription_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      case_briefs: {
        Row: {
          clinician_alert_id: string
          draft_review_note: string | null
          error_message: string | null
          generated_at: string
          id: string
          input_snapshot: Json
          model_id: string
          organisation_id: string
          patient_id: string
          protocol_slug: string | null
          protocol_version_id: string | null
          status: Database["public"]["Enums"]["case_brief_status"]
          suggested_action_text: string | null
          summary_text: string | null
        }
        Insert: {
          clinician_alert_id: string
          draft_review_note?: string | null
          error_message?: string | null
          generated_at?: string
          id?: string
          input_snapshot: Json
          model_id: string
          organisation_id: string
          patient_id: string
          protocol_slug?: string | null
          protocol_version_id?: string | null
          status: Database["public"]["Enums"]["case_brief_status"]
          suggested_action_text?: string | null
          summary_text?: string | null
        }
        Update: {
          clinician_alert_id?: string
          draft_review_note?: string | null
          error_message?: string | null
          generated_at?: string
          id?: string
          input_snapshot?: Json
          model_id?: string
          organisation_id?: string
          patient_id?: string
          protocol_slug?: string | null
          protocol_version_id?: string | null
          status?: Database["public"]["Enums"]["case_brief_status"]
          suggested_action_text?: string | null
          summary_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_briefs_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: true
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_briefs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_briefs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_briefs_protocol_version_id_fkey"
            columns: ["protocol_version_id"]
            isOneToOne: false
            referencedRelation: "protocol_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      case_review_actions: {
        Row: {
          action_type: Database["public"]["Enums"]["case_review_action_type"]
          clinician_alert_id: string
          confirmed_at: string | null
          confirmed_at_tier: Database["public"]["Enums"]["doctor_tier"] | null
          confirmed_by: string | null
          confirmed_by_staff: string | null
          confirmed_payload: Json | null
          dismissal_reason: string | null
          dismissed_at: string | null
          dismissed_by_staff: string | null
          engine_version: number
          id: string
          organisation_id: string
          patient_id: string
          proposed_at: string
          proposed_payload: Json
          protocol_version_id: string | null
          rationale: string
          required_authority: Database["public"]["Enums"]["case_review_authority"]
          result_id: string | null
          result_table: string | null
          source: string
          status: Database["public"]["Enums"]["case_review_action_status"]
        }
        Insert: {
          action_type: Database["public"]["Enums"]["case_review_action_type"]
          clinician_alert_id: string
          confirmed_at?: string | null
          confirmed_at_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          confirmed_by?: string | null
          confirmed_by_staff?: string | null
          confirmed_payload?: Json | null
          dismissal_reason?: string | null
          dismissed_at?: string | null
          dismissed_by_staff?: string | null
          engine_version: number
          id?: string
          organisation_id: string
          patient_id: string
          proposed_at?: string
          proposed_payload?: Json
          protocol_version_id?: string | null
          rationale: string
          required_authority?: Database["public"]["Enums"]["case_review_authority"]
          result_id?: string | null
          result_table?: string | null
          source?: string
          status?: Database["public"]["Enums"]["case_review_action_status"]
        }
        Update: {
          action_type?: Database["public"]["Enums"]["case_review_action_type"]
          clinician_alert_id?: string
          confirmed_at?: string | null
          confirmed_at_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          confirmed_by?: string | null
          confirmed_by_staff?: string | null
          confirmed_payload?: Json | null
          dismissal_reason?: string | null
          dismissed_at?: string | null
          dismissed_by_staff?: string | null
          engine_version?: number
          id?: string
          organisation_id?: string
          patient_id?: string
          proposed_at?: string
          proposed_payload?: Json
          protocol_version_id?: string | null
          rationale?: string
          required_authority?: Database["public"]["Enums"]["case_review_authority"]
          result_id?: string | null
          result_table?: string | null
          source?: string
          status?: Database["public"]["Enums"]["case_review_action_status"]
        }
        Relationships: [
          {
            foreignKeyName: "case_review_actions_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_review_actions_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_review_actions_confirmed_by_staff_fkey"
            columns: ["confirmed_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_review_actions_dismissed_by_staff_fkey"
            columns: ["dismissed_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_review_actions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_review_actions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_review_actions_protocol_version_id_fkey"
            columns: ["protocol_version_id"]
            isOneToOne: false
            referencedRelation: "protocol_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      cgm_connections: {
        Row: {
          cgm_partner_id: string
          connected_at: string
          created_at: string
          external_device_id: string | null
          id: string
          organisation_id: string
          patient_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cgm_partner_id: string
          connected_at?: string
          created_at?: string
          external_device_id?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cgm_partner_id?: string
          connected_at?: string
          created_at?: string
          external_device_id?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cgm_connections_cgm_partner_id_fkey"
            columns: ["cgm_partner_id"]
            isOneToOne: false
            referencedRelation: "cgm_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgm_connections_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgm_connections_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cgm_partners: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      chronic_condition_programmes: {
        Row: {
          category: string
          code: string
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at: string
          id: string
          is_active: boolean
          launch_priority: number
          monitoring_vitals: Database["public"]["Enums"]["vital_type"][]
          name: string
          protocol_slug: string
          review_cadence_months: number
          short_description: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          id?: string
          is_active?: boolean
          launch_priority?: number
          monitoring_vitals?: Database["public"]["Enums"]["vital_type"][]
          name: string
          protocol_slug: string
          review_cadence_months?: number
          short_description?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          id?: string
          is_active?: boolean
          launch_priority?: number
          monitoring_vitals?: Database["public"]["Enums"]["vital_type"][]
          name?: string
          protocol_slug?: string
          review_cadence_months?: number
          short_description?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chronic_programme_enrolments: {
        Row: {
          care_plan_id: string | null
          created_at: string
          enrolled_at: string
          id: string
          notes: string | null
          organisation_id: string
          patient_id: string
          programme_id: string
          source: Database["public"]["Enums"]["chronic_enrolment_source"]
          status: Database["public"]["Enums"]["chronic_enrolment_status"]
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          care_plan_id?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          programme_id: string
          source?: Database["public"]["Enums"]["chronic_enrolment_source"]
          status?: Database["public"]["Enums"]["chronic_enrolment_status"]
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          care_plan_id?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          programme_id?: string
          source?: Database["public"]["Enums"]["chronic_enrolment_source"]
          status?: Database["public"]["Enums"]["chronic_enrolment_status"]
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chronic_programme_enrolments_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chronic_programme_enrolments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chronic_programme_enrolments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chronic_programme_enrolments_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "chronic_condition_programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_encounter_notes: {
        Row: {
          assessment: string | null
          async_consult_id: string | null
          authored_by_profile: string | null
          authored_by_staff: string | null
          created_at: string
          diagnosis: string | null
          encounter_date: string
          encounter_type: string
          escalation_id: string | null
          examination_findings: string | null
          finalized_at: string | null
          finalized_by_staff: string | null
          follow_up_instructions: string | null
          history: string | null
          id: string
          organisation_id: string
          patient_id: string
          plan: string | null
          reason_for_encounter: string
          status: string
          updated_at: string
          video_consultation_id: string | null
        }
        Insert: {
          assessment?: string | null
          async_consult_id?: string | null
          authored_by_profile?: string | null
          authored_by_staff?: string | null
          created_at?: string
          diagnosis?: string | null
          encounter_date?: string
          encounter_type: string
          escalation_id?: string | null
          examination_findings?: string | null
          finalized_at?: string | null
          finalized_by_staff?: string | null
          follow_up_instructions?: string | null
          history?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          plan?: string | null
          reason_for_encounter: string
          status?: string
          updated_at?: string
          video_consultation_id?: string | null
        }
        Update: {
          assessment?: string | null
          async_consult_id?: string | null
          authored_by_profile?: string | null
          authored_by_staff?: string | null
          created_at?: string
          diagnosis?: string | null
          encounter_date?: string
          encounter_type?: string
          escalation_id?: string | null
          examination_findings?: string | null
          finalized_at?: string | null
          finalized_by_staff?: string | null
          follow_up_instructions?: string | null
          history?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          plan?: string | null
          reason_for_encounter?: string
          status?: string
          updated_at?: string
          video_consultation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_encounter_notes_async_consult_id_fkey"
            columns: ["async_consult_id"]
            isOneToOne: false
            referencedRelation: "async_consults"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_encounter_notes_authored_by_profile_fkey"
            columns: ["authored_by_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_encounter_notes_authored_by_staff_fkey"
            columns: ["authored_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_encounter_notes_escalation_id_fkey"
            columns: ["escalation_id"]
            isOneToOne: false
            referencedRelation: "escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_encounter_notes_finalized_by_staff_fkey"
            columns: ["finalized_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_encounter_notes_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_encounter_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_encounter_notes_video_consultation_id_fkey"
            columns: ["video_consultation_id"]
            isOneToOne: false
            referencedRelation: "video_consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_incident_reports: {
        Row: {
          category: string
          closed_at: string | null
          closed_by_staff: string | null
          contributing_factors: string | null
          corrective_action: string | null
          created_at: string
          description: string
          id: string
          immediate_action_taken: string | null
          occurred_at: string | null
          organisation_id: string
          patient_id: string | null
          reported_at: string
          reported_by: string | null
          review_outcome: string | null
          reviewed_at: string | null
          reviewed_by_staff: string | null
          reviewed_by_tier: Database["public"]["Enums"]["doctor_tier"] | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          closed_at?: string | null
          closed_by_staff?: string | null
          contributing_factors?: string | null
          corrective_action?: string | null
          created_at?: string
          description: string
          id?: string
          immediate_action_taken?: string | null
          occurred_at?: string | null
          organisation_id: string
          patient_id?: string | null
          reported_at?: string
          reported_by?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          reviewed_by_staff?: string | null
          reviewed_by_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          severity: string
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          closed_at?: string | null
          closed_by_staff?: string | null
          contributing_factors?: string | null
          corrective_action?: string | null
          created_at?: string
          description?: string
          id?: string
          immediate_action_taken?: string | null
          occurred_at?: string | null
          organisation_id?: string
          patient_id?: string | null
          reported_at?: string
          reported_by?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          reviewed_by_staff?: string | null
          reviewed_by_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_incident_reports_closed_by_staff_fkey"
            columns: ["closed_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_incident_reports_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_incident_reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_incident_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_incident_reports_reviewed_by_staff_fkey"
            columns: ["reviewed_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_staff: {
        Row: {
          active: boolean
          bio: string | null
          created_at: string
          credential_number: string | null
          credential_type: string | null
          credential_verified_at: string | null
          credential_verified_by: string | null
          doctor_tier: Database["public"]["Enums"]["doctor_tier"] | null
          full_name: string
          id: string
          indemnity_exempt: boolean
          indemnity_exempt_by: string | null
          indemnity_expires_at: string | null
          indemnity_insurer: string | null
          indemnity_policy_number: string | null
          is_clinical_director: boolean
          license_expires_at: string | null
          license_verified_at: string | null
          organisation_id: string
          photo_url: string | null
          profile_id: string | null
          red_flag_attested_at: string | null
          specialty: string | null
          staff_number: string | null
          updated_at: string
          verified_by: string | null
        }
        Insert: {
          active?: boolean
          bio?: string | null
          created_at?: string
          credential_number?: string | null
          credential_type?: string | null
          credential_verified_at?: string | null
          credential_verified_by?: string | null
          doctor_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          full_name: string
          id?: string
          indemnity_exempt?: boolean
          indemnity_exempt_by?: string | null
          indemnity_expires_at?: string | null
          indemnity_insurer?: string | null
          indemnity_policy_number?: string | null
          is_clinical_director?: boolean
          license_expires_at?: string | null
          license_verified_at?: string | null
          organisation_id: string
          photo_url?: string | null
          profile_id?: string | null
          red_flag_attested_at?: string | null
          specialty?: string | null
          staff_number?: string | null
          updated_at?: string
          verified_by?: string | null
        }
        Update: {
          active?: boolean
          bio?: string | null
          created_at?: string
          credential_number?: string | null
          credential_type?: string | null
          credential_verified_at?: string | null
          credential_verified_by?: string | null
          doctor_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          full_name?: string
          id?: string
          indemnity_exempt?: boolean
          indemnity_exempt_by?: string | null
          indemnity_expires_at?: string | null
          indemnity_insurer?: string | null
          indemnity_policy_number?: string | null
          is_clinical_director?: boolean
          license_expires_at?: string | null
          license_verified_at?: string | null
          organisation_id?: string
          photo_url?: string | null
          profile_id?: string | null
          red_flag_attested_at?: string | null
          specialty?: string | null
          staff_number?: string | null
          updated_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_staff_credential_verified_by_fkey"
            columns: ["credential_verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_staff_indemnity_exempt_by_fkey"
            columns: ["indemnity_exempt_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_staff_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_staff_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_staff_attestations: {
        Row: {
          attestation_version: string
          attested_at: string
          clinical_staff_id: string
          created_at: string
          expires_at: string
          id: string
          organisation_id: string
        }
        Insert: {
          attestation_version?: string
          attested_at?: string
          clinical_staff_id: string
          created_at?: string
          expires_at: string
          id?: string
          organisation_id: string
        }
        Update: {
          attestation_version?: string
          attested_at?: string
          clinical_staff_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_staff_attestations_clinical_staff_id_fkey"
            columns: ["clinical_staff_id"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_staff_attestations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_staff_indemnity_exemptions: {
        Row: {
          applies_to_director: boolean
          created_at: string
          doctor_tier: Database["public"]["Enums"]["doctor_tier"] | null
          exempted_by: string
          id: string
          organisation_id: string
          reason: string | null
        }
        Insert: {
          applies_to_director?: boolean
          created_at?: string
          doctor_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          exempted_by: string
          id?: string
          organisation_id: string
          reason?: string | null
        }
        Update: {
          applies_to_director?: boolean
          created_at?: string
          doctor_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          exempted_by?: string
          id?: string
          organisation_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_staff_indemnity_exemptions_exempted_by_fkey"
            columns: ["exempted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_staff_indemnity_exemptions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_staff_indemnity_lapse_notifications: {
        Row: {
          already_expired: boolean
          clinical_staff_id: string
          created_at: string
          id: string
          notified_on: string
        }
        Insert: {
          already_expired: boolean
          clinical_staff_id: string
          created_at?: string
          id?: string
          notified_on?: string
        }
        Update: {
          already_expired?: boolean
          clinical_staff_id?: string
          created_at?: string
          id?: string
          notified_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_staff_indemnity_lapse_notificat_clinical_staff_id_fkey"
            columns: ["clinical_staff_id"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_staff_license_lapse_notifications: {
        Row: {
          already_expired: boolean
          clinical_staff_id: string
          created_at: string
          id: string
          notified_on: string
        }
        Insert: {
          already_expired: boolean
          clinical_staff_id: string
          created_at?: string
          id?: string
          notified_on?: string
        }
        Update: {
          already_expired?: boolean
          clinical_staff_id?: string
          created_at?: string
          id?: string
          notified_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_staff_license_lapse_notificatio_clinical_staff_id_fkey"
            columns: ["clinical_staff_id"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      clinician_alert_sla_breach_notifications: {
        Row: {
          clinician_alert_id: string
          created_at: string
          escalation_tier: number
          id: string
          notified_on: string
        }
        Insert: {
          clinician_alert_id: string
          created_at?: string
          escalation_tier: number
          id?: string
          notified_on?: string
        }
        Update: {
          clinician_alert_id?: string
          created_at?: string
          escalation_tier?: number
          id?: string
          notified_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinician_alert_sla_breach_notification_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      clinician_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          detail: string | null
          escalation_level: number | null
          id: string
          level: Database["public"]["Enums"]["alert_level"]
          organisation_id: string
          overridden_at: string | null
          overridden_by: string | null
          override_level: Database["public"]["Enums"]["alert_level"] | null
          override_reason: string | null
          patient_id: string
          protocol_scope_exceeded: boolean
          protocol_scope_exceeded_at: string | null
          protocol_scope_exceeded_note: string | null
          screening_result_id: string | null
          sla_due_at: string | null
          status: Database["public"]["Enums"]["alert_status"]
          title: string
          updated_at: string
          vital_reading_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          detail?: string | null
          escalation_level?: number | null
          id?: string
          level?: Database["public"]["Enums"]["alert_level"]
          organisation_id: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_level?: Database["public"]["Enums"]["alert_level"] | null
          override_reason?: string | null
          patient_id: string
          protocol_scope_exceeded?: boolean
          protocol_scope_exceeded_at?: string | null
          protocol_scope_exceeded_note?: string | null
          screening_result_id?: string | null
          sla_due_at?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          title: string
          updated_at?: string
          vital_reading_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          detail?: string | null
          escalation_level?: number | null
          id?: string
          level?: Database["public"]["Enums"]["alert_level"]
          organisation_id?: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_level?: Database["public"]["Enums"]["alert_level"] | null
          override_reason?: string | null
          patient_id?: string
          protocol_scope_exceeded?: boolean
          protocol_scope_exceeded_at?: string | null
          protocol_scope_exceeded_note?: string | null
          screening_result_id?: string | null
          sla_due_at?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          title?: string
          updated_at?: string
          vital_reading_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinician_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinician_alerts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinician_alerts_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinician_alerts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinician_alerts_screening_result_id_fkey"
            columns: ["screening_result_id"]
            isOneToOne: false
            referencedRelation: "screening_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinician_alerts_vital_reading_id_fkey"
            columns: ["vital_reading_id"]
            isOneToOne: false
            referencedRelation: "vitals_readings"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_cost_model_constants: {
        Row: {
          estimated_cost_avoided_per_abnormal_catch_kobo: number
          id: string
          organisation_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          estimated_cost_avoided_per_abnormal_catch_kobo?: number
          id?: string
          organisation_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          estimated_cost_avoided_per_abnormal_catch_kobo?: number
          id?: string
          organisation_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cohort_cost_model_constants_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_cost_model_constants_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount_kobo: number
          commission_type: Database["public"]["Enums"]["commission_type"]
          created_at: string
          earned_at: string
          id: string
          organisation_id: string
          paid_at: string | null
          partner_name: string | null
          rate: number | null
          rate_type: Database["public"]["Enums"]["commission_rate_type"]
          source_id: string | null
          source_reference: string | null
          status: Database["public"]["Enums"]["commission_status"]
          updated_at: string
        }
        Insert: {
          amount_kobo?: number
          commission_type: Database["public"]["Enums"]["commission_type"]
          created_at?: string
          earned_at?: string
          id?: string
          organisation_id: string
          paid_at?: string | null
          partner_name?: string | null
          rate?: number | null
          rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          source_id?: string | null
          source_reference?: string | null
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Update: {
          amount_kobo?: number
          commission_type?: Database["public"]["Enums"]["commission_type"]
          created_at?: string
          earned_at?: string
          id?: string
          organisation_id?: string
          paid_at?: string | null
          partner_name?: string | null
          rate?: number | null
          rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          source_id?: string | null
          source_reference?: string | null
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_protocols: {
        Row: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at: string
          escalation: Json
          follow_up: Json
          id: string
          investigations: Json
          monitoring: Json
          prevention: Json
          protocol_slug: string
          source: string
          source_reference: string | null
          summary: string
          updated_at: string
        }
        Insert: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          escalation?: Json
          follow_up?: Json
          id?: string
          investigations?: Json
          monitoring?: Json
          prevention?: Json
          protocol_slug: string
          source?: string
          source_reference?: string | null
          summary: string
          updated_at?: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          escalation?: Json
          follow_up?: Json
          id?: string
          investigations?: Json
          monitoring?: Json
          prevention?: Json
          protocol_slug?: string
          source?: string
          source_reference?: string | null
          summary?: string
          updated_at?: string
        }
        Relationships: []
      }
      condition_screen_cadences: {
        Row: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          control_state: Database["public"]["Enums"]["chronic_control_state"]
          interval_months: number
          note: string | null
          screen_type_code: string
        }
        Insert: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          control_state: Database["public"]["Enums"]["chronic_control_state"]
          interval_months: number
          note?: string | null
          screen_type_code: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          control_state?: Database["public"]["Enums"]["chronic_control_state"]
          interval_months?: number
          note?: string | null
          screen_type_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "condition_screen_cadences_screen_type_code_fkey"
            columns: ["screen_type_code"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["code"]
          },
        ]
      }
      consent_versions: {
        Row: {
          body: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          created_at: string
          id: string
          is_current: boolean
          published_at: string
          title: string
          version: string
        }
        Insert: {
          body: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          created_at?: string
          id?: string
          is_current?: boolean
          published_at?: string
          title: string
          version: string
        }
        Update: {
          body?: string
          consent_type?: Database["public"]["Enums"]["consent_type"]
          created_at?: string
          id?: string
          is_current?: boolean
          published_at?: string
          title?: string
          version?: string
        }
        Relationships: []
      }
      consult_availability_slots: {
        Row: {
          booked_consultation_id: string | null
          clinician_profile_id: string
          created_at: string
          id: string
          organisation_id: string
          slot_end: string
          slot_start: string
        }
        Insert: {
          booked_consultation_id?: string | null
          clinician_profile_id: string
          created_at?: string
          id?: string
          organisation_id: string
          slot_end: string
          slot_start: string
        }
        Update: {
          booked_consultation_id?: string | null
          clinician_profile_id?: string
          created_at?: string
          id?: string
          organisation_id?: string
          slot_end?: string
          slot_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "consult_availability_slots_booked_consultation_id_fkey"
            columns: ["booked_consultation_id"]
            isOneToOne: false
            referencedRelation: "video_consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consult_availability_slots_clinician_profile_id_fkey"
            columns: ["clinician_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consult_availability_slots_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_contracts: {
        Row: {
          created_at: string
          effective_from: string | null
          effective_to: string | null
          employee_count: number
          id: string
          name: string
          organisation_id: string
          per_employee_per_year_kobo: number
          status: Database["public"]["Enums"]["contract_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          employee_count?: number
          id?: string
          name: string
          organisation_id: string
          per_employee_per_year_kobo?: number
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          employee_count?: number
          id?: string
          name?: string
          organisation_id?: string
          per_employee_per_year_kobo?: number
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_contracts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          base_role: Database["public"]["Enums"]["user_role"]
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          base_role: Database["public"]["Enums"]["user_role"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["user_role"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_roles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_risk_config: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          config: Json
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          organisation_id: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          config: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organisation_id: string
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organisation_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cv_risk_config_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_risk_config_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_breach_deadline_notifications: {
        Row: {
          created_at: string
          id: string
          incident_id: string
          notified_on: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_id: string
          notified_on?: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_id?: string
          notified_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_breach_deadline_notifications_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "data_breach_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      data_breach_incidents: {
        Row: {
          affected_data_categories: string[]
          closed_at: string | null
          closed_by: string | null
          containment_actions: string | null
          created_at: string
          description: string
          discovered_at: string
          estimated_affected_patients: number | null
          follow_up_actions: string | null
          id: string
          ndpc_notification_reference: string | null
          ndpc_notified_at: string | null
          patients_notified_at: string | null
          reported_by: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          affected_data_categories?: string[]
          closed_at?: string | null
          closed_by?: string | null
          containment_actions?: string | null
          created_at?: string
          description: string
          discovered_at: string
          estimated_affected_patients?: number | null
          follow_up_actions?: string | null
          id?: string
          ndpc_notification_reference?: string | null
          ndpc_notified_at?: string | null
          patients_notified_at?: string | null
          reported_by?: string | null
          severity: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          affected_data_categories?: string[]
          closed_at?: string | null
          closed_by?: string | null
          containment_actions?: string | null
          created_at?: string
          description?: string
          discovered_at?: string
          estimated_affected_patients?: number | null
          follow_up_actions?: string | null
          id?: string
          ndpc_notification_reference?: string | null
          ndpc_notified_at?: string | null
          patients_notified_at?: string | null
          reported_by?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_breach_incidents_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_breach_incidents_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_catalog: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["device_catalog_category"]
          clinically_reviewed: boolean
          created_at: string
          description: string | null
          device_name: string
          display_order: number
          fulfillment_type: Database["public"]["Enums"]["device_catalog_fulfillment_type"]
          gatt_service_uuids: string[]
          id: string
          image_url: string | null
          pairing_path: Database["public"]["Enums"]["device_catalog_pairing_path"]
          price_range_ngn: string | null
          updated_at: string
          vendor_name: string | null
          vendor_sdk_ref: string | null
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["device_catalog_category"]
          clinically_reviewed?: boolean
          created_at?: string
          description?: string | null
          device_name: string
          display_order?: number
          fulfillment_type?: Database["public"]["Enums"]["device_catalog_fulfillment_type"]
          gatt_service_uuids?: string[]
          id?: string
          image_url?: string | null
          pairing_path: Database["public"]["Enums"]["device_catalog_pairing_path"]
          price_range_ngn?: string | null
          updated_at?: string
          vendor_name?: string | null
          vendor_sdk_ref?: string | null
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["device_catalog_category"]
          clinically_reviewed?: boolean
          created_at?: string
          description?: string | null
          device_name?: string
          display_order?: number
          fulfillment_type?: Database["public"]["Enums"]["device_catalog_fulfillment_type"]
          gatt_service_uuids?: string[]
          id?: string
          image_url?: string | null
          pairing_path?: Database["public"]["Enums"]["device_catalog_pairing_path"]
          price_range_ngn?: string | null
          updated_at?: string
          vendor_name?: string | null
          vendor_sdk_ref?: string | null
        }
        Relationships: []
      }
      diabetes_complication_checks: {
        Row: {
          abnormal: boolean
          check_type: Database["public"]["Enums"]["complication_check_type"]
          created_at: string
          done_at: string
          id: string
          next_due_at: string | null
          organisation_id: string
          outcome: string | null
          patient_id: string
          recorded_by: string | null
          updated_at: string
        }
        Insert: {
          abnormal?: boolean
          check_type: Database["public"]["Enums"]["complication_check_type"]
          created_at?: string
          done_at?: string
          id?: string
          next_due_at?: string | null
          organisation_id: string
          outcome?: string | null
          patient_id: string
          recorded_by?: string | null
          updated_at?: string
        }
        Update: {
          abnormal?: boolean
          check_type?: Database["public"]["Enums"]["complication_check_type"]
          created_at?: string
          done_at?: string
          id?: string
          next_due_at?: string | null
          organisation_id?: string
          outcome?: string | null
          patient_id?: string
          recorded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diabetes_complication_checks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diabetes_complication_checks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diabetes_complication_checks_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      diabetic_foot_assessments: {
        Row: {
          assessed_at: string
          assessed_by: string | null
          created_at: string
          findings: string | null
          id: string
          next_due_at: string | null
          organisation_id: string
          patient_id: string
          pulses_present: boolean | null
          risk_class: Database["public"]["Enums"]["foot_risk_class"]
          sensation_left: Database["public"]["Enums"]["foot_sensation"] | null
          sensation_right: Database["public"]["Enums"]["foot_sensation"] | null
          updated_at: string
        }
        Insert: {
          assessed_at?: string
          assessed_by?: string | null
          created_at?: string
          findings?: string | null
          id?: string
          next_due_at?: string | null
          organisation_id: string
          patient_id: string
          pulses_present?: boolean | null
          risk_class: Database["public"]["Enums"]["foot_risk_class"]
          sensation_left?: Database["public"]["Enums"]["foot_sensation"] | null
          sensation_right?: Database["public"]["Enums"]["foot_sensation"] | null
          updated_at?: string
        }
        Update: {
          assessed_at?: string
          assessed_by?: string | null
          created_at?: string
          findings?: string | null
          id?: string
          next_due_at?: string | null
          organisation_id?: string
          patient_id?: string
          pulses_present?: boolean | null
          risk_class?: Database["public"]["Enums"]["foot_risk_class"]
          sensation_left?: Database["public"]["Enums"]["foot_sensation"] | null
          sensation_right?: Database["public"]["Enums"]["foot_sensation"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "diabetic_foot_assessments_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diabetic_foot_assessments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diabetic_foot_assessments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drug_monitoring_rules: {
        Row: {
          created_at: string
          drug_class: string
          id: string
          interval_months: number | null
          is_active: boolean
          match_pattern: string
          monitor_on_initiation: boolean
          monitoring_label: string
        }
        Insert: {
          created_at?: string
          drug_class: string
          id?: string
          interval_months?: number | null
          is_active?: boolean
          match_pattern: string
          monitor_on_initiation?: boolean
          monitoring_label: string
        }
        Update: {
          created_at?: string
          drug_class?: string
          id?: string
          interval_months?: number | null
          is_active?: boolean
          match_pattern?: string
          monitor_on_initiation?: boolean
          monitoring_label?: string
        }
        Relationships: []
      }
      ecg_parameter_readings: {
        Row: {
          code: string
          confirmed_at: string
          confirmed_by: string
          created_at: string
          ecg_report_document_id: string | null
          id: string
          organisation_id: string
          patient_id: string
          taken_at: string
          unit: string | null
          value: number | null
          value_text: string | null
        }
        Insert: {
          code: string
          confirmed_at?: string
          confirmed_by: string
          created_at?: string
          ecg_report_document_id?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          taken_at?: string
          unit?: string | null
          value?: number | null
          value_text?: string | null
        }
        Update: {
          code?: string
          confirmed_at?: string
          confirmed_by?: string
          created_at?: string
          ecg_report_document_id?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          taken_at?: string
          unit?: string | null
          value?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecg_parameter_readings_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_parameter_readings_ecg_report_document_id_fkey"
            columns: ["ecg_report_document_id"]
            isOneToOne: false
            referencedRelation: "ecg_report_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_parameter_readings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_parameter_readings_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ecg_report_documents: {
        Row: {
          clinician_alert_id: string | null
          created_at: string
          file_path: string
          file_size_bytes: number | null
          id: string
          lab_order_id: string | null
          mime_type: string | null
          note: string | null
          organisation_id: string
          original_filename: string | null
          patient_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: Database["public"]["Enums"]["ecg_report_document_source"]
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          clinician_alert_id?: string | null
          created_at?: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          lab_order_id?: string | null
          mime_type?: string | null
          note?: string | null
          organisation_id: string
          original_filename?: string | null
          patient_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: Database["public"]["Enums"]["ecg_report_document_source"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          clinician_alert_id?: string | null
          created_at?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          lab_order_id?: string | null
          mime_type?: string | null
          note?: string | null
          organisation_id?: string
          original_filename?: string | null
          patient_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: Database["public"]["Enums"]["ecg_report_document_source"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecg_report_documents_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_documents_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_documents_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_documents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_documents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ecg_report_extractions: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_codes: Json
          created_at: string
          document_id: string
          error_message: string | null
          facility_name: string | null
          id: string
          looks_twelve_lead: boolean | null
          model_id: string | null
          organisation_id: string
          parameters: Json
          patient_id: string
          patient_name_on_report: string | null
          report_date: string | null
          status: string
          unreadable_reason: string | null
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_codes?: Json
          created_at?: string
          document_id: string
          error_message?: string | null
          facility_name?: string | null
          id?: string
          looks_twelve_lead?: boolean | null
          model_id?: string | null
          organisation_id: string
          parameters?: Json
          patient_id: string
          patient_name_on_report?: string | null
          report_date?: string | null
          status: string
          unreadable_reason?: string | null
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_codes?: Json
          created_at?: string
          document_id?: string
          error_message?: string | null
          facility_name?: string | null
          id?: string
          looks_twelve_lead?: boolean | null
          model_id?: string | null
          organisation_id?: string
          parameters?: Json
          patient_id?: string
          patient_name_on_report?: string | null
          report_date?: string | null
          status?: string
          unreadable_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecg_report_extractions_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "ecg_report_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_extractions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecg_report_extractions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_card_lookups: {
        Row: {
          card_id: string
          id: string
          looked_up_at: string
        }
        Insert: {
          card_id: string
          id?: string
          looked_up_at?: string
        }
        Update: {
          card_id?: string
          id?: string
          looked_up_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_card_lookups_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "emergency_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_cards: {
        Row: {
          consented_at: string
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          last_viewed_at: string | null
          last_viewed_on: string | null
          organisation_id: string
          patient_id: string
          renewal_nudged_at: string | null
          revoked_at: string | null
          token: string
          view_count: number
        }
        Insert: {
          consented_at?: string
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          last_viewed_at?: string | null
          last_viewed_on?: string | null
          organisation_id: string
          patient_id: string
          renewal_nudged_at?: string | null
          revoked_at?: string | null
          token: string
          view_count?: number
        }
        Update: {
          consented_at?: string
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          last_viewed_at?: string | null
          last_viewed_on?: string | null
          organisation_id?: string
          patient_id?: string
          renewal_nudged_at?: string | null
          revoked_at?: string | null
          token?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "emergency_cards_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_cards_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          clinician_alert_id: string | null
          contact_notified_at: string | null
          created_at: string
          follow_up_due_at: string
          follow_up_notified_at: string | null
          followed_up_at: string | null
          followed_up_by: string | null
          id: string
          logged_by_profile_id: string | null
          organisation_id: string
          patient_id: string
          source: Database["public"]["Enums"]["emergency_source"]
          status: Database["public"]["Enums"]["emergency_event_status"]
          suppress_contact_notify: boolean
          trigger_detail: string | null
          updated_at: string
          vital_reading_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          clinician_alert_id?: string | null
          contact_notified_at?: string | null
          created_at?: string
          follow_up_due_at?: string
          follow_up_notified_at?: string | null
          followed_up_at?: string | null
          followed_up_by?: string | null
          id?: string
          logged_by_profile_id?: string | null
          organisation_id: string
          patient_id: string
          source: Database["public"]["Enums"]["emergency_source"]
          status?: Database["public"]["Enums"]["emergency_event_status"]
          suppress_contact_notify?: boolean
          trigger_detail?: string | null
          updated_at?: string
          vital_reading_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          clinician_alert_id?: string | null
          contact_notified_at?: string | null
          created_at?: string
          follow_up_due_at?: string
          follow_up_notified_at?: string | null
          followed_up_at?: string | null
          followed_up_by?: string | null
          id?: string
          logged_by_profile_id?: string | null
          organisation_id?: string
          patient_id?: string
          source?: Database["public"]["Enums"]["emergency_source"]
          status?: Database["public"]["Enums"]["emergency_event_status"]
          suppress_contact_notify?: boolean
          trigger_detail?: string | null
          updated_at?: string
          vital_reading_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emergency_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_events_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_events_followed_up_by_fkey"
            columns: ["followed_up_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_events_logged_by_profile_id_fkey"
            columns: ["logged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_events_vital_reading_id_fkey"
            columns: ["vital_reading_id"]
            isOneToOne: false
            referencedRelation: "vitals_readings"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_roster_members: {
        Row: {
          added_by: string | null
          claimed_at: string | null
          claimed_profile_id: string | null
          created_at: string
          full_name: string | null
          id: string
          organisation_id: string
          phone: string
          status: Database["public"]["Enums"]["employer_roster_status"]
        }
        Insert: {
          added_by?: string | null
          claimed_at?: string | null
          claimed_profile_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          organisation_id: string
          phone: string
          status?: Database["public"]["Enums"]["employer_roster_status"]
        }
        Update: {
          added_by?: string | null
          claimed_at?: string | null
          claimed_profile_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          organisation_id?: string
          phone?: string
          status?: Database["public"]["Enums"]["employer_roster_status"]
        }
        Relationships: [
          {
            foreignKeyName: "employer_roster_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_roster_members_claimed_profile_id_fkey"
            columns: ["claimed_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_roster_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_notes: {
        Row: {
          author_id: string | null
          created_at: string
          escalation_id: string
          id: string
          next_follow_up_at: string | null
          note: string
          organisation_id: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          escalation_id: string
          id?: string
          next_follow_up_at?: string | null
          note: string
          organisation_id: string
        }
        Update: {
          author_id?: string | null
          created_at?: string
          escalation_id?: string
          id?: string
          next_follow_up_at?: string | null
          note?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_notes_escalation_id_fkey"
            columns: ["escalation_id"]
            isOneToOne: false
            referencedRelation: "escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_notes_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_slas: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          config: Json
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          config: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "escalation_slas_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      escalations: {
        Row: {
          assigned_doctor_id: string | null
          clinician_alert_id: string | null
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          raised_by: string | null
          reason: string
          resolution_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["escalation_status"]
          updated_at: string
        }
        Insert: {
          assigned_doctor_id?: string | null
          clinician_alert_id?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          raised_by?: string | null
          reason: string
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Update: {
          assigned_doctor_id?: string | null
          clinician_alert_id?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          raised_by?: string | null
          reason?: string
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalations_assigned_doctor_id_fkey"
            columns: ["assigned_doctor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exposure_retest_rules: {
        Row: {
          basis: string
          definitive_test_days: number | null
          earliest_test_days: number
          exposure_code: string
          screen_type_code: string
        }
        Insert: {
          basis: string
          definitive_test_days?: number | null
          earliest_test_days: number
          exposure_code: string
          screen_type_code: string
        }
        Update: {
          basis?: string
          definitive_test_days?: number | null
          earliest_test_days?: number
          exposure_code?: string
          screen_type_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "exposure_retest_rules_exposure_code_fkey"
            columns: ["exposure_code"]
            isOneToOne: false
            referencedRelation: "exposure_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exposure_retest_rules_screen_type_code_fkey"
            columns: ["screen_type_code"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["code"]
          },
        ]
      }
      exposure_types: {
        Row: {
          code: string
          description: string
          is_active: boolean
          label: string
          pep_relevant: boolean
          pep_window_hours: number | null
          routes_to_human: boolean
          sort_order: number
        }
        Insert: {
          code: string
          description: string
          is_active?: boolean
          label: string
          pep_relevant?: boolean
          pep_window_hours?: number | null
          routes_to_human?: boolean
          sort_order?: number
        }
        Update: {
          code?: string
          description?: string
          is_active?: boolean
          label?: string
          pep_relevant?: boolean
          pep_window_hours?: number | null
          routes_to_human?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      facilities: {
        Row: {
          address: string | null
          area: string | null
          city: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          hours: string | null
          id: string
          is_active: boolean
          lab_provider_id: string | null
          latitude: number | null
          longitude: number | null
          name: string
          pharmacy_partner_id: string | null
          state: string
          type: Database["public"]["Enums"]["facility_type"]
          verified: boolean
        }
        Insert: {
          address?: string | null
          area?: string | null
          city: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          hours?: string | null
          id?: string
          is_active?: boolean
          lab_provider_id?: string | null
          latitude?: number | null
          longitude?: number | null
          name: string
          pharmacy_partner_id?: string | null
          state: string
          type: Database["public"]["Enums"]["facility_type"]
          verified?: boolean
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          hours?: string | null
          id?: string
          is_active?: boolean
          lab_provider_id?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          pharmacy_partner_id?: string | null
          state?: string
          type?: Database["public"]["Enums"]["facility_type"]
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "facilities_lab_provider_id_fkey"
            columns: ["lab_provider_id"]
            isOneToOne: false
            referencedRelation: "lab_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_pharmacy_partner_id_fkey"
            columns: ["pharmacy_partner_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_services: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          price_kobo: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          price_kobo?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          price_kobo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_services_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      family_history: {
        Row: {
          age_of_onset_years: number | null
          condition_name: string
          created_at: string
          id: string
          is_deceased: boolean | null
          notes: string | null
          organisation_id: string
          patient_id: string
          recorded_by: string | null
          relationship: Database["public"]["Enums"]["family_relationship"]
          relationship_detail: string | null
          source: string
          updated_at: string
        }
        Insert: {
          age_of_onset_years?: number | null
          condition_name: string
          created_at?: string
          id?: string
          is_deceased?: boolean | null
          notes?: string | null
          organisation_id: string
          patient_id: string
          recorded_by?: string | null
          relationship: Database["public"]["Enums"]["family_relationship"]
          relationship_detail?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          age_of_onset_years?: number | null
          condition_name?: string
          created_at?: string
          id?: string
          is_deceased?: boolean | null
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          recorded_by?: string | null
          relationship?: Database["public"]["Enums"]["family_relationship"]
          relationship_detail?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_history_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_history_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_history_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fhir_import_batches: {
        Row: {
          api_key_id: string
          fhir_bundle_identifier: string | null
          id: string
          organisation_id: string
          patient_id: string
          raw_bundle: Json
          received_at: string
          resource_counts: Json
          skip_reasons: Json
          source_system: string | null
        }
        Insert: {
          api_key_id: string
          fhir_bundle_identifier?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          raw_bundle: Json
          received_at?: string
          resource_counts?: Json
          skip_reasons?: Json
          source_system?: string | null
        }
        Update: {
          api_key_id?: string
          fhir_bundle_identifier?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          raw_bundle?: Json
          received_at?: string
          resource_counts?: Json
          skip_reasons?: Json
          source_system?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fhir_import_batches_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fhir_import_batches_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fhir_import_batches_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fhir_import_proposed_resources: {
        Row: {
          batch_id: string
          confirmed_at: string | null
          confirmed_at_tier: Database["public"]["Enums"]["doctor_tier"] | null
          confirmed_by: string | null
          confirmed_by_staff: string | null
          confirmed_payload: Json | null
          dismissal_reason: string | null
          dismissed_at: string | null
          dismissed_by_staff: string | null
          fhir_resource_id: string | null
          id: string
          normalized_payload: Json
          organisation_id: string
          parse_warnings: Json
          parser_version: number
          patient_id: string
          proposed_at: string
          raw_resource: Json
          resource_type: Database["public"]["Enums"]["fhir_import_resource_type"]
          result_id: string | null
          result_table: string | null
          source: string
          status: Database["public"]["Enums"]["fhir_import_resource_status"]
        }
        Insert: {
          batch_id: string
          confirmed_at?: string | null
          confirmed_at_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          confirmed_by?: string | null
          confirmed_by_staff?: string | null
          confirmed_payload?: Json | null
          dismissal_reason?: string | null
          dismissed_at?: string | null
          dismissed_by_staff?: string | null
          fhir_resource_id?: string | null
          id?: string
          normalized_payload: Json
          organisation_id: string
          parse_warnings?: Json
          parser_version: number
          patient_id: string
          proposed_at?: string
          raw_resource: Json
          resource_type: Database["public"]["Enums"]["fhir_import_resource_type"]
          result_id?: string | null
          result_table?: string | null
          source?: string
          status?: Database["public"]["Enums"]["fhir_import_resource_status"]
        }
        Update: {
          batch_id?: string
          confirmed_at?: string | null
          confirmed_at_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          confirmed_by?: string | null
          confirmed_by_staff?: string | null
          confirmed_payload?: Json | null
          dismissal_reason?: string | null
          dismissed_at?: string | null
          dismissed_by_staff?: string | null
          fhir_resource_id?: string | null
          id?: string
          normalized_payload?: Json
          organisation_id?: string
          parse_warnings?: Json
          parser_version?: number
          patient_id?: string
          proposed_at?: string
          raw_resource?: Json
          resource_type?: Database["public"]["Enums"]["fhir_import_resource_type"]
          result_id?: string | null
          result_table?: string | null
          source?: string
          status?: Database["public"]["Enums"]["fhir_import_resource_status"]
        }
        Relationships: [
          {
            foreignKeyName: "fhir_import_proposed_resources_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fhir_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fhir_import_proposed_resources_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fhir_import_proposed_resources_confirmed_by_staff_fkey"
            columns: ["confirmed_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fhir_import_proposed_resources_dismissed_by_staff_fkey"
            columns: ["dismissed_by_staff"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fhir_import_proposed_resources_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fhir_import_proposed_resources_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_accounts: {
        Row: {
          account_type: string
          cash_flow_category: string | null
          code: string
          created_at: string
          description: string | null
          is_active: boolean
          name: string
          normal_balance: string
          sort_order: number
          updated_at: string
          vat_treatment: string
        }
        Insert: {
          account_type: string
          cash_flow_category?: string | null
          code: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name: string
          normal_balance: string
          sort_order?: number
          updated_at?: string
          vat_treatment?: string
        }
        Update: {
          account_type?: string
          cash_flow_category?: string | null
          code?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name?: string
          normal_balance?: string
          sort_order?: number
          updated_at?: string
          vat_treatment?: string
        }
        Relationships: []
      }
      finance_approval_requests: {
        Row: {
          created_at: string
          id: string
          payload: Json
          reason: string | null
          request_type: string
          requested_at: string
          requested_by: string | null
          result_entry_id: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload: Json
          reason?: string | null
          request_type: string
          requested_at?: string
          requested_by?: string | null
          result_entry_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          reason?: string | null
          request_type?: string
          requested_at?: string
          requested_by?: string | null
          result_entry_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_approval_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_approval_requests_result_entry_id_fkey"
            columns: ["result_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_approval_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_approval_settings: {
        Row: {
          currency: Database["public"]["Enums"]["currency"]
          threshold_minor: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          currency: Database["public"]["Enums"]["currency"]
          threshold_minor: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          currency?: Database["public"]["Enums"]["currency"]
          threshold_minor?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_approval_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_bills: {
        Row: {
          amount_minor: number
          approve_journal_entry_id: string | null
          approved_at: string | null
          approved_by: string | null
          bank_account_code: string | null
          bill_date: string
          bill_no: number
          cost_center_code: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency"]
          description: string | null
          due_date: string | null
          expense_account_code: string
          id: string
          paid_at: string | null
          pay_journal_entry_id: string | null
          status: string
          updated_at: string
          vendor_id: string
          wht_minor: number
          wht_rate_pct: number
        }
        Insert: {
          amount_minor: number
          approve_journal_entry_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          bank_account_code?: string | null
          bill_date: string
          bill_no?: number
          cost_center_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"]
          description?: string | null
          due_date?: string | null
          expense_account_code: string
          id?: string
          paid_at?: string | null
          pay_journal_entry_id?: string | null
          status?: string
          updated_at?: string
          vendor_id: string
          wht_minor?: number
          wht_rate_pct?: number
        }
        Update: {
          amount_minor?: number
          approve_journal_entry_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          bank_account_code?: string | null
          bill_date?: string
          bill_no?: number
          cost_center_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"]
          description?: string | null
          due_date?: string | null
          expense_account_code?: string
          id?: string
          paid_at?: string | null
          pay_journal_entry_id?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string
          wht_minor?: number
          wht_rate_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_bills_approve_journal_entry_id_fkey"
            columns: ["approve_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bills_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bills_bank_account_code_fkey"
            columns: ["bank_account_code"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_bills_cost_center_code_fkey"
            columns: ["cost_center_code"]
            isOneToOne: false
            referencedRelation: "finance_cost_centers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_bills_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bills_expense_account_code_fkey"
            columns: ["expense_account_code"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_bills_pay_journal_entry_id_fkey"
            columns: ["pay_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_bills_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "finance_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_budgets: {
        Row: {
          account_code: string
          amount_minor: number
          cost_center_code: string | null
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency"]
          id: string
          notes: string | null
          period_month: string
          updated_at: string
        }
        Insert: {
          account_code: string
          amount_minor: number
          cost_center_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"]
          id?: string
          notes?: string | null
          period_month: string
          updated_at?: string
        }
        Update: {
          account_code?: string
          amount_minor?: number
          cost_center_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"]
          id?: string
          notes?: string | null
          period_month?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_budgets_account_code_fkey"
            columns: ["account_code"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_budgets_cost_center_code_fkey"
            columns: ["cost_center_code"]
            isOneToOne: false
            referencedRelation: "finance_cost_centers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_company_profile: {
        Row: {
          auditor_name: string | null
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          company_secretary_name: string | null
          directors_text: string | null
          financial_year_end: string
          incorporation_date: string | null
          itf_number: string | null
          legal_name: string | null
          nsitf_number: string | null
          pension_pfa_code: string | null
          principal_business_activity: string | null
          rc_number: string | null
          registered_address: string | null
          registered_email: string | null
          registered_phone: string | null
          singleton: boolean
          tin: string | null
          trading_name: string | null
          updated_at: string
          updated_by: string | null
          vat_registration_number: string | null
        }
        Insert: {
          auditor_name?: string | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          company_secretary_name?: string | null
          directors_text?: string | null
          financial_year_end?: string
          incorporation_date?: string | null
          itf_number?: string | null
          legal_name?: string | null
          nsitf_number?: string | null
          pension_pfa_code?: string | null
          principal_business_activity?: string | null
          rc_number?: string | null
          registered_address?: string | null
          registered_email?: string | null
          registered_phone?: string | null
          singleton?: boolean
          tin?: string | null
          trading_name?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_registration_number?: string | null
        }
        Update: {
          auditor_name?: string | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          company_secretary_name?: string | null
          directors_text?: string | null
          financial_year_end?: string
          incorporation_date?: string | null
          itf_number?: string | null
          legal_name?: string | null
          nsitf_number?: string | null
          pension_pfa_code?: string | null
          principal_business_activity?: string | null
          rc_number?: string | null
          registered_address?: string | null
          registered_email?: string | null
          registered_phone?: string | null
          singleton?: boolean
          tin?: string | null
          trading_name?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_registration_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_company_profile_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_compliance_obligation_types: {
        Row: {
          agency: string
          code: string
          description: string | null
          due_day_of_month: number | null
          due_months_after_period_end: number | null
          frequency: string
          is_active: boolean
          name: string
        }
        Insert: {
          agency: string
          code: string
          description?: string | null
          due_day_of_month?: number | null
          due_months_after_period_end?: number | null
          frequency: string
          is_active?: boolean
          name: string
        }
        Update: {
          agency?: string
          code?: string
          description?: string | null
          due_day_of_month?: number | null
          due_months_after_period_end?: number | null
          frequency?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      finance_cost_centers: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      finance_filings: {
        Row: {
          amount_minor: number | null
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          due_date: string
          filed_at: string | null
          filed_by: string | null
          id: string
          notes: string | null
          obligation_code: string
          period_label: string
          remittance_reference: string | null
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          due_date: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          notes?: string | null
          obligation_code: string
          period_label: string
          remittance_reference?: string | null
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          due_date?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          notes?: string | null
          obligation_code?: string
          period_label?: string
          remittance_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_filings_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_filings_obligation_code_fkey"
            columns: ["obligation_code"]
            isOneToOne: false
            referencedRelation: "finance_compliance_obligation_types"
            referencedColumns: ["code"]
          },
        ]
      }
      finance_journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency"]
          entry_date: string
          entry_no: number
          id: string
          is_reversed: boolean
          memo: string | null
          period_month: string
          reversal_of: string | null
          source: string
          source_ref: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"]
          entry_date: string
          entry_no?: number
          id?: string
          is_reversed?: boolean
          memo?: string | null
          period_month: string
          reversal_of?: string | null
          source: string
          source_ref?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"]
          entry_date?: string
          entry_no?: number
          id?: string
          is_reversed?: boolean
          memo?: string | null
          period_month?: string
          reversal_of?: string | null
          source?: string
          source_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_journal_lines: {
        Row: {
          account_code: string
          cost_center_code: string | null
          counterparty: string | null
          created_at: string
          credit_minor: number
          currency: Database["public"]["Enums"]["currency"]
          debit_minor: number
          entry_id: string
          id: string
          line_no: number
          memo: string | null
          organisation_id: string | null
        }
        Insert: {
          account_code: string
          cost_center_code?: string | null
          counterparty?: string | null
          created_at?: string
          credit_minor?: number
          currency?: Database["public"]["Enums"]["currency"]
          debit_minor?: number
          entry_id: string
          id?: string
          line_no?: number
          memo?: string | null
          organisation_id?: string | null
        }
        Update: {
          account_code?: string
          cost_center_code?: string | null
          counterparty?: string | null
          created_at?: string
          credit_minor?: number
          currency?: Database["public"]["Enums"]["currency"]
          debit_minor?: number
          entry_id?: string
          id?: string
          line_no?: number
          memo?: string | null
          organisation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_journal_lines_account_code_fkey"
            columns: ["account_code"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_journal_lines_cost_center_code_fkey"
            columns: ["cost_center_code"]
            isOneToOne: false
            referencedRelation: "finance_cost_centers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_journal_lines_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_partner_revenue_policy: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          id: boolean
          note: string
          treatment: Database["public"]["Enums"]["partner_revenue_treatment"]
          updated_at: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          id?: boolean
          note: string
          treatment?: Database["public"]["Enums"]["partner_revenue_treatment"]
          updated_at?: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          id?: boolean
          note?: string
          treatment?: Database["public"]["Enums"]["partner_revenue_treatment"]
          updated_at?: string
        }
        Relationships: []
      }
      finance_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          locked_at: string | null
          locked_by: string | null
          period_month: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          locked_at?: string | null
          locked_by?: string | null
          period_month: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          locked_at?: string | null
          locked_by?: string | null
          period_month?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_settlement_matches: {
        Row: {
          amount_minor: number
          created_at: string
          id: string
          matched_by: string | null
          payment_transaction_id: string
          settlement_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          id?: string
          matched_by?: string | null
          payment_transaction_id: string
          settlement_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          id?: string
          matched_by?: string | null
          payment_transaction_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_settlement_matches_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_settlement_matches_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_settlement_matches_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "finance_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_settlements: {
        Row: {
          bank_account_code: string
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          external_ref: string | null
          fees_minor: number
          gross_minor: number
          id: string
          imported_by: string | null
          journal_entry_id: string | null
          net_minor: number
          notes: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          settlement_date: string
          status: string
          updated_at: string
        }
        Insert: {
          bank_account_code?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          external_ref?: string | null
          fees_minor?: number
          gross_minor?: number
          id?: string
          imported_by?: string | null
          journal_entry_id?: string | null
          net_minor?: number
          notes?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          settlement_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          bank_account_code?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          external_ref?: string | null
          fees_minor?: number
          gross_minor?: number
          id?: string
          imported_by?: string | null
          journal_entry_id?: string | null
          net_minor?: number
          notes?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          settlement_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_settlements_bank_account_code_fkey"
            columns: ["bank_account_code"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "finance_settlements_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_settlements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_tax_rates: {
        Row: {
          applies_to: string | null
          created_at: string
          effective_from: string
          id: string
          is_active: boolean
          jurisdiction: string
          name: string
          notes: string | null
          rate_pct: number
          tax_type: string
          updated_at: string
        }
        Insert: {
          applies_to?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          jurisdiction?: string
          name: string
          notes?: string | null
          rate_pct: number
          tax_type: string
          updated_at?: string
        }
        Update: {
          applies_to?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          jurisdiction?: string
          name?: string
          notes?: string | null
          rate_pct?: number
          tax_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_vendors: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          tin: string | null
          updated_at: string
          vendor_type: string | null
          wht_applicable: boolean
          wht_rate_pct: number | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tin?: string | null
          updated_at?: string
          vendor_type?: string | null
          wht_applicable?: boolean
          wht_rate_pct?: number | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tin?: string | null
          updated_at?: string
          vendor_type?: string | null
          wht_applicable?: boolean
          wht_rate_pct?: number | null
        }
        Relationships: []
      }
      foot_self_checks: {
        Row: {
          any_problem: boolean
          checked_at: string
          clinician_alert_id: string | null
          created_at: string
          findings: string[]
          id: string
          note: string | null
          organisation_id: string
          patient_id: string
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          any_problem?: boolean
          checked_at?: string
          clinician_alert_id?: string | null
          created_at?: string
          findings?: string[]
          id?: string
          note?: string | null
          organisation_id: string
          patient_id: string
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          any_problem?: boolean
          checked_at?: string
          clinician_alert_id?: string | null
          created_at?: string
          findings?: string[]
          id?: string
          note?: string | null
          organisation_id?: string
          patient_id?: string
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "foot_self_checks_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foot_self_checks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "foot_self_checks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      glycaemic_target_defaults: {
        Row: {
          category: Database["public"]["Enums"]["glycaemic_target_category"]
          hba1c_target_percent: number
        }
        Insert: {
          category: Database["public"]["Enums"]["glycaemic_target_category"]
          hba1c_target_percent: number
        }
        Update: {
          category?: Database["public"]["Enums"]["glycaemic_target_category"]
          hba1c_target_percent?: number
        }
        Relationships: []
      }
      health_education_content: {
        Row: {
          body: string
          category: Database["public"]["Enums"]["health_education_category"]
          clinician_reviewed: boolean
          code: string
          condition: Database["public"]["Enums"]["care_plan_condition"] | null
          content_type: Database["public"]["Enums"]["health_education_content_type"]
          created_at: string
          drip_week: number | null
          estimated_minutes: number | null
          id: string
          is_active: boolean
          knowledge_check: Json | null
          min_risk_level: Database["public"]["Enums"]["risk_level"] | null
          reviewed_at: string | null
          reviewed_by_name: string | null
          sort_order: number
          summary: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          body: string
          category: Database["public"]["Enums"]["health_education_category"]
          clinician_reviewed?: boolean
          code: string
          condition?: Database["public"]["Enums"]["care_plan_condition"] | null
          content_type?: Database["public"]["Enums"]["health_education_content_type"]
          created_at?: string
          drip_week?: number | null
          estimated_minutes?: number | null
          id?: string
          is_active?: boolean
          knowledge_check?: Json | null
          min_risk_level?: Database["public"]["Enums"]["risk_level"] | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          sort_order?: number
          summary?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          body?: string
          category?: Database["public"]["Enums"]["health_education_category"]
          clinician_reviewed?: boolean
          code?: string
          condition?: Database["public"]["Enums"]["care_plan_condition"] | null
          content_type?: Database["public"]["Enums"]["health_education_content_type"]
          created_at?: string
          drip_week?: number | null
          estimated_minutes?: number | null
          id?: string
          is_active?: boolean
          knowledge_check?: Json | null
          min_risk_level?: Database["public"]["Enums"]["risk_level"] | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          sort_order?: number
          summary?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      health_education_progress: {
        Row: {
          check_score: number | null
          check_total: number | null
          content_id: string
          created_at: string
          id: string
          last_viewed_at: string
          organisation_id: string
          patient_id: string
          status: Database["public"]["Enums"]["health_education_status"]
          updated_at: string
        }
        Insert: {
          check_score?: number | null
          check_total?: number | null
          content_id: string
          created_at?: string
          id?: string
          last_viewed_at?: string
          organisation_id: string
          patient_id: string
          status?: Database["public"]["Enums"]["health_education_status"]
          updated_at?: string
        }
        Update: {
          check_score?: number | null
          check_total?: number | null
          content_id?: string
          created_at?: string
          id?: string
          last_viewed_at?: string
          organisation_id?: string
          patient_id?: string
          status?: Database["public"]["Enums"]["health_education_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_education_progress_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "health_education_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_education_progress_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_education_progress_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_education_unlock_notifications: {
        Row: {
          id: string
          notified_at: string
          organisation_id: string
          patient_id: string
          track_key: string
          unlock_week: number
        }
        Insert: {
          id?: string
          notified_at?: string
          organisation_id: string
          patient_id: string
          track_key: string
          unlock_week: number
        }
        Update: {
          id?: string
          notified_at?: string
          organisation_id?: string
          patient_id?: string
          track_key?: string
          unlock_week?: number
        }
        Relationships: [
          {
            foreignKeyName: "health_education_unlock_notifications_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_education_unlock_notifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_passport_attestation_requests: {
        Row: {
          created_at: string
          decline_reason: string | null
          id: string
          organisation_id: string
          patient_id: string
          patient_note: string | null
          purpose: string
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          statement: string | null
          status: Database["public"]["Enums"]["health_passport_attestation_status"]
        }
        Insert: {
          created_at?: string
          decline_reason?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          patient_note?: string | null
          purpose: string
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          statement?: string | null
          status?: Database["public"]["Enums"]["health_passport_attestation_status"]
        }
        Update: {
          created_at?: string
          decline_reason?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          patient_note?: string | null
          purpose?: string
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          statement?: string | null
          status?: Database["public"]["Enums"]["health_passport_attestation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "health_passport_attestation_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_passport_attestation_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_passport_attestation_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_passport_issuances: {
        Row: {
          attestation_request_id: string | null
          attestation_statement: string | null
          attested_at: string | null
          attested_by: string | null
          attesting_credential_number: string | null
          attesting_credential_type: string | null
          attesting_doctor_name: string | null
          content_digest: string | null
          content_snapshot: Json | null
          created_at: string
          expires_at: string
          id: string
          issued_at: string
          last_verified_at: string | null
          last_verified_on: string | null
          organisation_id: string
          patient_id: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          serial: string
          signature: string | null
          signed_payload: string | null
          signing_kid: string | null
          status: Database["public"]["Enums"]["health_passport_status"]
          subject_dob: string | null
          subject_name: string
          subject_patient_number: string | null
          verification_count: number
        }
        Insert: {
          attestation_request_id?: string | null
          attestation_statement?: string | null
          attested_at?: string | null
          attested_by?: string | null
          attesting_credential_number?: string | null
          attesting_credential_type?: string | null
          attesting_doctor_name?: string | null
          content_digest?: string | null
          content_snapshot?: Json | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_at?: string
          last_verified_at?: string | null
          last_verified_on?: string | null
          organisation_id: string
          patient_id: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          serial: string
          signature?: string | null
          signed_payload?: string | null
          signing_kid?: string | null
          status?: Database["public"]["Enums"]["health_passport_status"]
          subject_dob?: string | null
          subject_name: string
          subject_patient_number?: string | null
          verification_count?: number
        }
        Update: {
          attestation_request_id?: string | null
          attestation_statement?: string | null
          attested_at?: string | null
          attested_by?: string | null
          attesting_credential_number?: string | null
          attesting_credential_type?: string | null
          attesting_doctor_name?: string | null
          content_digest?: string | null
          content_snapshot?: Json | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_at?: string
          last_verified_at?: string | null
          last_verified_on?: string | null
          organisation_id?: string
          patient_id?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          serial?: string
          signature?: string | null
          signed_payload?: string | null
          signing_kid?: string | null
          status?: Database["public"]["Enums"]["health_passport_status"]
          subject_dob?: string | null
          subject_name?: string
          subject_patient_number?: string | null
          verification_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "health_passport_issuances_attestation_request_id_fkey"
            columns: ["attestation_request_id"]
            isOneToOne: false
            referencedRelation: "health_passport_attestation_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_passport_issuances_attested_by_fkey"
            columns: ["attested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_passport_issuances_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_passport_issuances_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_passport_issuances_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_passport_issuances_signing_kid_fkey"
            columns: ["signing_kid"]
            isOneToOne: false
            referencedRelation: "passport_signing_keys"
            referencedColumns: ["kid"]
          },
        ]
      }
      health_passport_verifications: {
        Row: {
          id: string
          identity_confirmed: boolean
          issuance_id: string
          verified_at: string
        }
        Insert: {
          id?: string
          identity_confirmed?: boolean
          issuance_id: string
          verified_at?: string
        }
        Update: {
          id?: string
          identity_confirmed?: boolean
          issuance_id?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_passport_verifications_issuance_id_fkey"
            columns: ["issuance_id"]
            isOneToOne: false
            referencedRelation: "health_passport_issuances"
            referencedColumns: ["id"]
          },
        ]
      }
      home_visit_providers: {
        Row: {
          address: string | null
          created_at: string
          home_visit_fee_kobo: number
          id: string
          is_active: boolean
          latitude: number | null
          license_expires_at: string | null
          license_number: string | null
          license_type: string | null
          license_verified_at: string | null
          license_verified_by: string | null
          longitude: number | null
          name: string
          regions: string[]
          sample_types: string[]
        }
        Insert: {
          address?: string | null
          created_at?: string
          home_visit_fee_kobo?: number
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          longitude?: number | null
          name: string
          regions?: string[]
          sample_types?: string[]
        }
        Update: {
          address?: string | null
          created_at?: string
          home_visit_fee_kobo?: number
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          longitude?: number | null
          name?: string
          regions?: string[]
          sample_types?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "home_visit_providers_license_verified_by_fkey"
            columns: ["license_verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_verifications: {
        Row: {
          created_at: string
          id: string
          id_last4: string | null
          metadata: Json
          method: Database["public"]["Enums"]["identity_method"]
          organisation_id: string
          patient_id: string
          provider: string | null
          reference: string | null
          status: Database["public"]["Enums"]["identity_verification_status"]
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          id_last4?: string | null
          metadata?: Json
          method: Database["public"]["Enums"]["identity_method"]
          organisation_id: string
          patient_id: string
          provider?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["identity_verification_status"]
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          id_last4?: string | null
          metadata?: Json
          method?: Database["public"]["Enums"]["identity_method"]
          organisation_id?: string
          patient_id?: string
          provider?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["identity_verification_status"]
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_verifications_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_verifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      insulin_logs: {
        Row: {
          created_at: string
          id: string
          injected_at: string
          insulin_type: Database["public"]["Enums"]["insulin_type"]
          note: string | null
          organisation_id: string
          patient_id: string
          units: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          injected_at?: string
          insulin_type: Database["public"]["Enums"]["insulin_type"]
          note?: string | null
          organisation_id: string
          patient_id: string
          units: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          injected_at?: string
          insulin_type?: Database["public"]["Enums"]["insulin_type"]
          note?: string | null
          organisation_id?: string
          patient_id?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insulin_logs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insulin_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_analyte_readings: {
        Row: {
          abnormal_flag: Database["public"]["Enums"]["lab_analyte_flag"] | null
          code: string
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          reference_range_high: number | null
          reference_range_low: number | null
          reference_range_text: string | null
          specimen_collected_at: string | null
          taken_at: string
          unit: string | null
          value: number | null
          value_text: string | null
        }
        Insert: {
          abnormal_flag?: Database["public"]["Enums"]["lab_analyte_flag"] | null
          code: string
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          reference_range_high?: number | null
          reference_range_low?: number | null
          reference_range_text?: string | null
          specimen_collected_at?: string | null
          taken_at?: string
          unit?: string | null
          value?: number | null
          value_text?: string | null
        }
        Update: {
          abnormal_flag?: Database["public"]["Enums"]["lab_analyte_flag"] | null
          code?: string
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          reference_range_high?: number | null
          reference_range_low?: number | null
          reference_range_text?: string | null
          specimen_collected_at?: string | null
          taken_at?: string
          unit?: string | null
          value?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_analyte_readings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_analyte_readings_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_extraction_corrections: {
        Row: {
          code: string
          confirmed_value: number | null
          confirmed_value_text: string | null
          created_at: string
          extraction_id: string
          id: string
          model_confidence: string | null
          organisation_id: string
          outcome: string
          printed_label: string | null
          printed_range: string | null
          printed_unit: string | null
          proposed_value: number | null
          proposed_value_text: string | null
          template_id: string | null
        }
        Insert: {
          code: string
          confirmed_value?: number | null
          confirmed_value_text?: string | null
          created_at?: string
          extraction_id: string
          id?: string
          model_confidence?: string | null
          organisation_id: string
          outcome: string
          printed_label?: string | null
          printed_range?: string | null
          printed_unit?: string | null
          proposed_value?: number | null
          proposed_value_text?: string | null
          template_id?: string | null
        }
        Update: {
          code?: string
          confirmed_value?: number | null
          confirmed_value_text?: string | null
          created_at?: string
          extraction_id?: string
          id?: string
          model_confidence?: string | null
          organisation_id?: string
          outcome?: string
          printed_label?: string | null
          printed_range?: string | null
          printed_unit?: string | null
          proposed_value?: number | null
          proposed_value_text?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_extraction_corrections_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "lab_report_extractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_extraction_corrections_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_extraction_corrections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "lab_report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_order_refunds: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          detail: string | null
          id: string
          journal_entry_id: string | null
          lab_order_id: string
          margin_portion_kobo: number
          organisation_id: string
          paid_at: string | null
          partner_portion_kobo: number
          reason: Database["public"]["Enums"]["lab_refund_reason"]
          refund_total_kobo: number
          requested_at: string
          requested_by: string | null
          status: Database["public"]["Enums"]["lab_refund_status"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          journal_entry_id?: string | null
          lab_order_id: string
          margin_portion_kobo?: number
          organisation_id: string
          paid_at?: string | null
          partner_portion_kobo?: number
          reason: Database["public"]["Enums"]["lab_refund_reason"]
          refund_total_kobo: number
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["lab_refund_status"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          journal_entry_id?: string | null
          lab_order_id?: string
          margin_portion_kobo?: number
          organisation_id?: string
          paid_at?: string | null
          partner_portion_kobo?: number
          reason?: Database["public"]["Enums"]["lab_refund_reason"]
          refund_total_kobo?: number
          requested_at?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["lab_refund_status"]
        }
        Relationships: [
          {
            foreignKeyName: "lab_order_refunds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_refunds_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "finance_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_refunds_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_refunds_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_refunds_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_order_refunds_reason_fkey"
            columns: ["reason"]
            isOneToOne: false
            referencedRelation: "lab_refund_policies"
            referencedColumns: ["reason"]
          },
          {
            foreignKeyName: "lab_order_refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_orders: {
        Row: {
          applied_voucher_id: string | null
          courier_reference: string | null
          created_at: string
          excluded_test_codes: Json
          facility_id: string | null
          fulfilment: Database["public"]["Enums"]["fulfilment_mode"]
          home_visit_provider_id: string | null
          home_visit_scheduled_at: string | null
          id: string
          investigation_tier: number
          order_number: string | null
          ordered_at: string
          ordered_by: string | null
          organisation_id: string
          origin: Database["public"]["Enums"]["booking_origin"]
          panel_bundle_id: string | null
          partner_cost_breakdown: Json | null
          partner_cost_kobo: number | null
          partner_cost_provider_id: string | null
          partner_reference: string | null
          patient_id: string
          payable_kobo: number | null
          payment_confirmed_at: string | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          preferred_time_of_day:
            | Database["public"]["Enums"]["lab_order_time_of_day"]
            | null
          provider_id: string | null
          resulted_at: string | null
          scheduled_date: string | null
          screening_schedule_id: string | null
          status: Database["public"]["Enums"]["lab_order_status"]
          subscriber_discount_kobo: number
          total_kobo: number
          transmission: Database["public"]["Enums"]["lab_order_transmission"]
          transmission_ack_at: string | null
          transmission_note: string | null
          transmitted_at: string | null
          updated_at: string
          voucher_covered_kobo: number
        }
        Insert: {
          applied_voucher_id?: string | null
          courier_reference?: string | null
          created_at?: string
          excluded_test_codes?: Json
          facility_id?: string | null
          fulfilment?: Database["public"]["Enums"]["fulfilment_mode"]
          home_visit_provider_id?: string | null
          home_visit_scheduled_at?: string | null
          id?: string
          investigation_tier?: number
          order_number?: string | null
          ordered_at?: string
          ordered_by?: string | null
          organisation_id: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          panel_bundle_id?: string | null
          partner_cost_breakdown?: Json | null
          partner_cost_kobo?: number | null
          partner_cost_provider_id?: string | null
          partner_reference?: string | null
          patient_id: string
          payable_kobo?: number | null
          payment_confirmed_at?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          preferred_time_of_day?:
            | Database["public"]["Enums"]["lab_order_time_of_day"]
            | null
          provider_id?: string | null
          resulted_at?: string | null
          scheduled_date?: string | null
          screening_schedule_id?: string | null
          status?: Database["public"]["Enums"]["lab_order_status"]
          subscriber_discount_kobo?: number
          total_kobo?: number
          transmission?: Database["public"]["Enums"]["lab_order_transmission"]
          transmission_ack_at?: string | null
          transmission_note?: string | null
          transmitted_at?: string | null
          updated_at?: string
          voucher_covered_kobo?: number
        }
        Update: {
          applied_voucher_id?: string | null
          courier_reference?: string | null
          created_at?: string
          excluded_test_codes?: Json
          facility_id?: string | null
          fulfilment?: Database["public"]["Enums"]["fulfilment_mode"]
          home_visit_provider_id?: string | null
          home_visit_scheduled_at?: string | null
          id?: string
          investigation_tier?: number
          order_number?: string | null
          ordered_at?: string
          ordered_by?: string | null
          organisation_id?: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          panel_bundle_id?: string | null
          partner_cost_breakdown?: Json | null
          partner_cost_kobo?: number | null
          partner_cost_provider_id?: string | null
          partner_reference?: string | null
          patient_id?: string
          payable_kobo?: number | null
          payment_confirmed_at?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          preferred_time_of_day?:
            | Database["public"]["Enums"]["lab_order_time_of_day"]
            | null
          provider_id?: string | null
          resulted_at?: string | null
          scheduled_date?: string | null
          screening_schedule_id?: string | null
          status?: Database["public"]["Enums"]["lab_order_status"]
          subscriber_discount_kobo?: number
          total_kobo?: number
          transmission?: Database["public"]["Enums"]["lab_order_transmission"]
          transmission_ack_at?: string | null
          transmission_note?: string | null
          transmitted_at?: string | null
          updated_at?: string
          voucher_covered_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "lab_orders_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_home_visit_provider_id_fkey"
            columns: ["home_visit_provider_id"]
            isOneToOne: false
            referencedRelation: "home_visit_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_ordered_by_fkey"
            columns: ["ordered_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_panel_bundle_id_fkey"
            columns: ["panel_bundle_id"]
            isOneToOne: false
            referencedRelation: "panel_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_partner_cost_provider_id_fkey"
            columns: ["partner_cost_provider_id"]
            isOneToOne: false
            referencedRelation: "lab_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "lab_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_screening_schedule_id_fkey"
            columns: ["screening_schedule_id"]
            isOneToOne: false
            referencedRelation: "screening_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_provider_locations: {
        Row: {
          address: string
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          lab_provider_id: string
          latitude: number | null
          longitude: number | null
          name: string
          state: string
        }
        Insert: {
          address: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lab_provider_id: string
          latitude?: number | null
          longitude?: number | null
          name: string
          state: string
        }
        Update: {
          address?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lab_provider_id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_provider_locations_lab_provider_id_fkey"
            columns: ["lab_provider_id"]
            isOneToOne: false
            referencedRelation: "lab_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_providers: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          home_collection: boolean
          id: string
          is_active: boolean
          license_expires_at: string | null
          license_number: string | null
          license_type: string | null
          license_verified_at: string | null
          license_verified_by: string | null
          name: string
          regions: string[]
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          home_collection?: boolean
          id?: string
          is_active?: boolean
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          name: string
          regions?: string[]
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          home_collection?: boolean
          id?: string
          is_active?: boolean
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          name?: string
          regions?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "lab_providers_license_verified_by_fkey"
            columns: ["license_verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_refund_policies: {
        Row: {
          note: string
          partner_still_owed: boolean
          reason: Database["public"]["Enums"]["lab_refund_reason"]
          refunds_in_full: boolean
        }
        Insert: {
          note: string
          partner_still_owed: boolean
          reason: Database["public"]["Enums"]["lab_refund_reason"]
          refunds_in_full: boolean
        }
        Update: {
          note?: string
          partner_still_owed?: boolean
          reason?: Database["public"]["Enums"]["lab_refund_reason"]
          refunds_in_full?: boolean
        }
        Relationships: []
      }
      lab_report_extractions: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_codes: Json
          created_at: string
          critical_suspected: boolean
          document_id: string
          error_message: string | null
          id: string
          lab_name: string | null
          lab_name_key: string | null
          layout_fingerprint: string | null
          model_id: string | null
          organisation_id: string
          patient_id: string
          patient_name_on_report: string | null
          report_date: string | null
          rows: Json
          status: string
          template_id: string | null
          unreadable_reason: string | null
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_codes?: Json
          created_at?: string
          critical_suspected?: boolean
          document_id: string
          error_message?: string | null
          id?: string
          lab_name?: string | null
          lab_name_key?: string | null
          layout_fingerprint?: string | null
          model_id?: string | null
          organisation_id: string
          patient_id: string
          patient_name_on_report?: string | null
          report_date?: string | null
          rows?: Json
          status: string
          template_id?: string | null
          unreadable_reason?: string | null
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_codes?: Json
          created_at?: string
          critical_suspected?: boolean
          document_id?: string
          error_message?: string | null
          id?: string
          lab_name?: string | null
          lab_name_key?: string | null
          layout_fingerprint?: string | null
          model_id?: string | null
          organisation_id?: string
          patient_id?: string
          patient_name_on_report?: string | null
          report_date?: string | null
          rows?: Json
          status?: string
          template_id?: string | null
          unreadable_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_report_extractions_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "lab_result_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_extractions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_extractions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_report_extractions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "lab_report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_report_templates: {
        Row: {
          created_at: string
          documents_seen: number
          first_seen_at: string
          hints: Json
          id: string
          lab_name: string
          lab_name_key: string
          last_seen_at: string
          layout_fingerprint: string
          readings_accepted: number
          readings_corrected: number
          readings_proposed: number
          readings_rejected: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          documents_seen?: number
          first_seen_at?: string
          hints?: Json
          id?: string
          lab_name: string
          lab_name_key: string
          last_seen_at?: string
          layout_fingerprint: string
          readings_accepted?: number
          readings_corrected?: number
          readings_proposed?: number
          readings_rejected?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          documents_seen?: number
          first_seen_at?: string
          hints?: Json
          id?: string
          lab_name?: string
          lab_name_key?: string
          last_seen_at?: string
          layout_fingerprint?: string
          readings_accepted?: number
          readings_corrected?: number
          readings_proposed?: number
          readings_rejected?: number
          updated_at?: string
        }
        Relationships: []
      }
      lab_result_documents: {
        Row: {
          clinician_alert_id: string | null
          created_at: string
          file_path: string
          file_size_bytes: number | null
          id: string
          interpretation_sent_at: string | null
          lab_order_id: string | null
          mime_type: string | null
          next_steps: string | null
          note: string | null
          organisation_id: string
          original_filename: string | null
          patient_id: string
          patient_interpretation: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          screening_completion_id: string | null
          source: Database["public"]["Enums"]["lab_result_document_source"]
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          clinician_alert_id?: string | null
          created_at?: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          interpretation_sent_at?: string | null
          lab_order_id?: string | null
          mime_type?: string | null
          next_steps?: string | null
          note?: string | null
          organisation_id: string
          original_filename?: string | null
          patient_id: string
          patient_interpretation?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          screening_completion_id?: string | null
          source: Database["public"]["Enums"]["lab_result_document_source"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          clinician_alert_id?: string | null
          created_at?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          interpretation_sent_at?: string | null
          lab_order_id?: string | null
          mime_type?: string | null
          next_steps?: string | null
          note?: string | null
          organisation_id?: string
          original_filename?: string | null
          patient_id?: string
          patient_interpretation?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          screening_completion_id?: string | null
          source?: Database["public"]["Enums"]["lab_result_document_source"]
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_result_documents_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_documents_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_documents_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_documents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_documents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_documents_screening_completion_id_fkey"
            columns: ["screening_completion_id"]
            isOneToOne: false
            referencedRelation: "screening_completions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_result_interpretations: {
        Row: {
          created_at: string
          id: string
          interpretation: Json
          lab_order_id: string | null
          model_version: string | null
          organisation_id: string
          patient_id: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          interpretation?: Json
          lab_order_id?: string | null
          model_version?: string | null
          organisation_id: string
          patient_id: string
          source?: string
        }
        Update: {
          created_at?: string
          id?: string
          interpretation?: Json
          lab_order_id?: string | null
          model_version?: string | null
          organisation_id?: string
          patient_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_result_interpretations_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_interpretations_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_interpretations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_result_interpretations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_tests: {
        Row: {
          code: string
          commission_flat_kobo: number | null
          commission_rate: number | null
          commission_rate_type: Database["public"]["Enums"]["commission_rate_type"]
          created_at: string
          id: string
          is_active: boolean
          name: string
          price_kobo: number
          provider_id: string
          turnaround_hours: number | null
        }
        Insert: {
          code: string
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          price_kobo?: number
          provider_id: string
          turnaround_hours?: number | null
        }
        Update: {
          code?: string
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          price_kobo?: number
          provider_id?: string
          turnaround_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_tests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "lab_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          contact: string
          contacted_at: string | null
          contacted_by: string | null
          created_at: string
          id: string
          message: string | null
          name: string
          role: Database["public"]["Enums"]["lead_role"]
          source: string
        }
        Insert: {
          contact: string
          contacted_at?: string | null
          contacted_by?: string | null
          created_at?: string
          id?: string
          message?: string | null
          name: string
          role: Database["public"]["Enums"]["lead_role"]
          source?: string
        }
        Update: {
          contact?: string
          contacted_at?: string | null
          contacted_by?: string | null
          created_at?: string
          id?: string
          message?: string | null
          name?: string
          role?: Database["public"]["Enums"]["lead_role"]
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_contacted_by_fkey"
            columns: ["contacted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      logistics_partners: {
        Row: {
          address: string | null
          created_at: string
          delivery_fee_kobo: number
          estimated_delivery_hours: number | null
          id: string
          is_active: boolean
          latitude: number | null
          license_expires_at: string | null
          license_number: string | null
          license_type: string | null
          license_verified_at: string | null
          license_verified_by: string | null
          longitude: number | null
          name: string
          regions: string[]
        }
        Insert: {
          address?: string | null
          created_at?: string
          delivery_fee_kobo?: number
          estimated_delivery_hours?: number | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          longitude?: number | null
          name: string
          regions?: string[]
        }
        Update: {
          address?: string | null
          created_at?: string
          delivery_fee_kobo?: number
          estimated_delivery_hours?: number | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          longitude?: number | null
          name?: string
          regions?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "logistics_partners_license_verified_by_fkey"
            columns: ["license_verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_consents: {
        Row: {
          channel: string | null
          created_at: string
          granted_at: string
          id: string
          organisation_id: string
          patient_id: string
          revoked_at: string | null
          scope: string
        }
        Insert: {
          channel?: string | null
          created_at?: string
          granted_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          revoked_at?: string | null
          scope?: string
        }
        Update: {
          channel?: string | null
          created_at?: string
          granted_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          revoked_at?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_consents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_consents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_content_blocks: {
        Row: {
          body_md: string
          clinician_reviewed: boolean
          condition: Database["public"]["Enums"]["care_plan_condition"] | null
          created_at: string
          embedding: string | null
          id: string
          key: string
          module: Database["public"]["Enums"]["lpe_module"] | null
          reading_level: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body_md: string
          clinician_reviewed?: boolean
          condition?: Database["public"]["Enums"]["care_plan_condition"] | null
          created_at?: string
          embedding?: string | null
          id?: string
          key: string
          module?: Database["public"]["Enums"]["lpe_module"] | null
          reading_level?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          clinician_reviewed?: boolean
          condition?: Database["public"]["Enums"]["care_plan_condition"] | null
          created_at?: string
          embedding?: string | null
          id?: string
          key?: string
          module?: Database["public"]["Enums"]["lpe_module"] | null
          reading_level?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      lpe_enrollments: {
        Row: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          consent_id: string | null
          created_at: string
          doctor_id: string | null
          ended_at: string | null
          id: string
          organisation_id: string
          patient_id: string
          patient_profile: Json | null
          paused_reason: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["lpe_enrollment_status"]
          updated_at: string
        }
        Insert: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          consent_id?: string | null
          created_at?: string
          doctor_id?: string | null
          ended_at?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          patient_profile?: Json | null
          paused_reason?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["lpe_enrollment_status"]
          updated_at?: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          consent_id?: string | null
          created_at?: string
          doctor_id?: string | null
          ended_at?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          patient_profile?: Json | null
          paused_reason?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["lpe_enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_enrollments_consent_fk"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "lpe_consents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_enrollments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_enrollments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_enrollments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_goal_instances: {
        Row: {
          created_at: string
          goal_template_id: string | null
          id: string
          metric_key: string | null
          module: Database["public"]["Enums"]["lpe_module"]
          organisation_id: string
          personalised: boolean
          programme_instance_id: string
          status: Database["public"]["Enums"]["lpe_goal_status"]
          target: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          goal_template_id?: string | null
          id?: string
          metric_key?: string | null
          module: Database["public"]["Enums"]["lpe_module"]
          organisation_id: string
          personalised?: boolean
          programme_instance_id: string
          status?: Database["public"]["Enums"]["lpe_goal_status"]
          target?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          goal_template_id?: string | null
          id?: string
          metric_key?: string | null
          module?: Database["public"]["Enums"]["lpe_module"]
          organisation_id?: string
          personalised?: boolean
          programme_instance_id?: string
          status?: Database["public"]["Enums"]["lpe_goal_status"]
          target?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_goal_instances_goal_template_id_fkey"
            columns: ["goal_template_id"]
            isOneToOne: false
            referencedRelation: "lpe_goal_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_goal_instances_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_goal_instances_programme_instance_id_fkey"
            columns: ["programme_instance_id"]
            isOneToOne: false
            referencedRelation: "lpe_programme_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_goal_templates: {
        Row: {
          cadence: string | null
          created_at: string
          description: string | null
          id: string
          key: string
          metric_key: string | null
          module: Database["public"]["Enums"]["lpe_module"]
          phase_template_id: string
          priority: number
          target: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          cadence?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key: string
          metric_key?: string | null
          module: Database["public"]["Enums"]["lpe_module"]
          phase_template_id: string
          priority?: number
          target?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          cadence?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          metric_key?: string | null
          module?: Database["public"]["Enums"]["lpe_module"]
          phase_template_id?: string
          priority?: number
          target?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_goal_templates_phase_template_id_fkey"
            columns: ["phase_template_id"]
            isOneToOne: false
            referencedRelation: "lpe_phase_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_measurements: {
        Row: {
          context: Json | null
          created_at: string
          enrollment_id: string | null
          flagged: boolean
          id: string
          organisation_id: string
          patient_id: string
          red_flag_event_id: string | null
          source: Database["public"]["Enums"]["lpe_measurement_source"]
          taken_at: string
          type: Database["public"]["Enums"]["lpe_measurement_type"]
          unit: string
          validated: boolean
          value_json: Json | null
          value_num: number | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          enrollment_id?: string | null
          flagged?: boolean
          id?: string
          organisation_id: string
          patient_id: string
          red_flag_event_id?: string | null
          source: Database["public"]["Enums"]["lpe_measurement_source"]
          taken_at: string
          type: Database["public"]["Enums"]["lpe_measurement_type"]
          unit: string
          validated?: boolean
          value_json?: Json | null
          value_num?: number | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          enrollment_id?: string | null
          flagged?: boolean
          id?: string
          organisation_id?: string
          patient_id?: string
          red_flag_event_id?: string | null
          source?: Database["public"]["Enums"]["lpe_measurement_source"]
          taken_at?: string
          type?: Database["public"]["Enums"]["lpe_measurement_type"]
          unit?: string
          validated?: boolean
          value_json?: Json | null
          value_num?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lpe_measurements_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "lpe_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_measurements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_measurements_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_measurements_red_flag_event_fk"
            columns: ["red_flag_event_id"]
            isOneToOne: false
            referencedRelation: "lpe_red_flag_events"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_phase_instances: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          organisation_id: string
          phase_template_id: string
          programme_instance_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["lpe_phase_status"]
          target_end_at: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          phase_template_id: string
          programme_instance_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["lpe_phase_status"]
          target_end_at?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          phase_template_id?: string
          programme_instance_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["lpe_phase_status"]
          target_end_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_phase_instances_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_phase_instances_phase_template_id_fkey"
            columns: ["phase_template_id"]
            isOneToOne: false
            referencedRelation: "lpe_phase_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_phase_instances_programme_instance_id_fkey"
            columns: ["programme_instance_id"]
            isOneToOne: false
            referencedRelation: "lpe_programme_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_phase_templates: {
        Row: {
          auto_advance: boolean
          created_at: string
          duration_days_max: number | null
          duration_days_min: number | null
          id: string
          key: string
          kind: Database["public"]["Enums"]["lpe_phase_kind"]
          name: string
          order_index: number
          programme_template_id: string
          updated_at: string
        }
        Insert: {
          auto_advance?: boolean
          created_at?: string
          duration_days_max?: number | null
          duration_days_min?: number | null
          id?: string
          key: string
          kind: Database["public"]["Enums"]["lpe_phase_kind"]
          name: string
          order_index: number
          programme_template_id: string
          updated_at?: string
        }
        Update: {
          auto_advance?: boolean
          created_at?: string
          duration_days_max?: number | null
          duration_days_min?: number | null
          id?: string
          key?: string
          kind?: Database["public"]["Enums"]["lpe_phase_kind"]
          name?: string
          order_index?: number
          programme_template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_phase_templates_programme_template_id_fkey"
            columns: ["programme_template_id"]
            isOneToOne: false
            referencedRelation: "lpe_programme_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_programme_instances: {
        Row: {
          created_at: string
          current_phase_instance_id: string | null
          enrollment_id: string
          goals_config: Json
          id: string
          organisation_id: string
          programme_template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_phase_instance_id?: string | null
          enrollment_id: string
          goals_config?: Json
          id?: string
          organisation_id: string
          programme_template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_phase_instance_id?: string | null
          enrollment_id?: string
          goals_config?: Json
          id?: string
          organisation_id?: string
          programme_template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_programme_instances_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: true
            referencedRelation: "lpe_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_programme_instances_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_programme_instances_programme_template_id_fkey"
            columns: ["programme_template_id"]
            isOneToOne: false
            referencedRelation: "lpe_programme_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_programme_templates: {
        Row: {
          active: boolean
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at: string
          id: string
          modules: Json
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          condition: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          id?: string
          modules?: Json
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          created_at?: string
          id?: string
          modules?: Json
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      lpe_red_flag_events: {
        Row: {
          action: Database["public"]["Enums"]["lpe_red_flag_action"]
          clinician_alert_id: string | null
          created_at: string
          enrollment_id: string | null
          escalation_level: number
          id: string
          measurement_id: string | null
          opened_at: string
          organisation_id: string
          patient_id: string
          rule_key: string
          severity: Database["public"]["Enums"]["lpe_red_flag_severity"]
          status: Database["public"]["Enums"]["lpe_red_flag_status"]
          stood_down_at: string | null
          stood_down_by: string | null
          stood_down_reason: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["lpe_red_flag_action"]
          clinician_alert_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          escalation_level: number
          id?: string
          measurement_id?: string | null
          opened_at?: string
          organisation_id: string
          patient_id: string
          rule_key: string
          severity: Database["public"]["Enums"]["lpe_red_flag_severity"]
          status?: Database["public"]["Enums"]["lpe_red_flag_status"]
          stood_down_at?: string | null
          stood_down_by?: string | null
          stood_down_reason?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["lpe_red_flag_action"]
          clinician_alert_id?: string | null
          created_at?: string
          enrollment_id?: string | null
          escalation_level?: number
          id?: string
          measurement_id?: string | null
          opened_at?: string
          organisation_id?: string
          patient_id?: string
          rule_key?: string
          severity?: Database["public"]["Enums"]["lpe_red_flag_severity"]
          status?: Database["public"]["Enums"]["lpe_red_flag_status"]
          stood_down_at?: string | null
          stood_down_by?: string | null
          stood_down_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lpe_red_flag_events_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_red_flag_events_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "lpe_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_red_flag_events_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "lpe_measurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_red_flag_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_red_flag_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_red_flag_events_stood_down_by_fkey"
            columns: ["stood_down_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_reviews: {
        Row: {
          completed_at: string | null
          created_at: string
          due_date: string
          enrollment_id: string
          id: string
          notes: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["medication_review_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_date: string
          enrollment_id: string
          id?: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["medication_review_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_date?: string
          enrollment_id?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["medication_review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_reviews_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "lpe_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_reviews_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_reviews_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_task_instances: {
        Row: {
          completed_at: string | null
          created_at: string
          due_at: string
          goal_instance_id: string
          id: string
          organisation_id: string
          patient_id: string
          source: Database["public"]["Enums"]["lpe_measurement_source"] | null
          status: Database["public"]["Enums"]["lpe_task_status"]
          task_window: Json | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_at: string
          goal_instance_id: string
          id?: string
          organisation_id: string
          patient_id: string
          source?: Database["public"]["Enums"]["lpe_measurement_source"] | null
          status?: Database["public"]["Enums"]["lpe_task_status"]
          task_window?: Json | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_at?: string
          goal_instance_id?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          source?: Database["public"]["Enums"]["lpe_measurement_source"] | null
          status?: Database["public"]["Enums"]["lpe_task_status"]
          task_window?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_task_instances_goal_instance_id_fkey"
            columns: ["goal_instance_id"]
            isOneToOne: false
            referencedRelation: "lpe_goal_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_task_instances_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lpe_task_instances_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_task_templates: {
        Row: {
          channel: Database["public"]["Enums"]["lpe_task_channel"]
          created_at: string
          goal_template_id: string
          id: string
          instruction: string | null
          key: string
          schedule: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["lpe_task_channel"]
          created_at?: string
          goal_template_id: string
          id?: string
          instruction?: string | null
          key: string
          schedule?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["lpe_task_channel"]
          created_at?: string
          goal_template_id?: string
          id?: string
          instruction?: string | null
          key?: string
          schedule?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lpe_task_templates_goal_template_id_fkey"
            columns: ["goal_template_id"]
            isOneToOne: false
            referencedRelation: "lpe_goal_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_resources: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          is_published: boolean
          read_minutes: number
          related_href: string | null
          related_label: string | null
          reviewed_at: string | null
          reviewed_by_name: string | null
          sections: Json
          slug: string
          sort_order: number
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          id?: string
          is_published?: boolean
          read_minutes?: number
          related_href?: string | null
          related_label?: string | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          sections?: Json
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          is_published?: boolean
          read_minutes?: number
          related_href?: string | null
          related_label?: string | null
          reviewed_at?: string | null
          reviewed_by_name?: string | null
          sections?: Json
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_resources_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      masked_call_participants: {
        Row: {
          added_at: string
          id: string
          organisation_id: string
          profile_id: string
          role: Database["public"]["Enums"]["masked_call_participant_role"]
          session_id: string
          twilio_participant_sid: string | null
          twilio_proxy_identifier: string | null
        }
        Insert: {
          added_at?: string
          id?: string
          organisation_id: string
          profile_id: string
          role: Database["public"]["Enums"]["masked_call_participant_role"]
          session_id: string
          twilio_participant_sid?: string | null
          twilio_proxy_identifier?: string | null
        }
        Update: {
          added_at?: string
          id?: string
          organisation_id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["masked_call_participant_role"]
          session_id?: string
          twilio_participant_sid?: string | null
          twilio_proxy_identifier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "masked_call_participants_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masked_call_participants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masked_call_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "masked_call_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      masked_call_sessions: {
        Row: {
          closed_at: string | null
          context: Database["public"]["Enums"]["masked_call_context"]
          created_at: string
          escalation_id: string | null
          expires_at: string
          id: string
          initiated_by: string
          organisation_id: string
          patient_id: string
          staff_profile_id: string
          status: Database["public"]["Enums"]["masked_call_session_status"]
          twilio_proxy_service_sid: string | null
          twilio_proxy_session_sid: string | null
          updated_at: string
          vendor_error: string | null
        }
        Insert: {
          closed_at?: string | null
          context: Database["public"]["Enums"]["masked_call_context"]
          created_at?: string
          escalation_id?: string | null
          expires_at?: string
          id?: string
          initiated_by: string
          organisation_id: string
          patient_id: string
          staff_profile_id: string
          status?: Database["public"]["Enums"]["masked_call_session_status"]
          twilio_proxy_service_sid?: string | null
          twilio_proxy_session_sid?: string | null
          updated_at?: string
          vendor_error?: string | null
        }
        Update: {
          closed_at?: string | null
          context?: Database["public"]["Enums"]["masked_call_context"]
          created_at?: string
          escalation_id?: string | null
          expires_at?: string
          id?: string
          initiated_by?: string
          organisation_id?: string
          patient_id?: string
          staff_profile_id?: string
          status?: Database["public"]["Enums"]["masked_call_session_status"]
          twilio_proxy_service_sid?: string | null
          twilio_proxy_session_sid?: string | null
          updated_at?: string
          vendor_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "masked_call_sessions_escalation_id_fkey"
            columns: ["escalation_id"]
            isOneToOne: false
            referencedRelation: "escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masked_call_sessions_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masked_call_sessions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masked_call_sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "masked_call_sessions_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_adherence_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          level: Database["public"]["Enums"]["med_adherence_alert_level"]
          medication_id: string
          missed_count: number
          organisation_id: string
          patient_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["med_adherence_alert_status"]
          updated_at: string
          window_days: number
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          level: Database["public"]["Enums"]["med_adherence_alert_level"]
          medication_id: string
          missed_count: number
          organisation_id: string
          patient_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["med_adherence_alert_status"]
          updated_at?: string
          window_days?: number
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["med_adherence_alert_level"]
          medication_id?: string
          missed_count?: number
          organisation_id?: string
          patient_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["med_adherence_alert_status"]
          updated_at?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "medication_adherence_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_adherence_alerts_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_adherence_alerts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_adherence_alerts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_adherence_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_adherence_checkins: {
        Row: {
          checkin_type: Database["public"]["Enums"]["medication_checkin_type"]
          created_at: string
          due_date: string
          id: string
          medication_id: string
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          responded_at: string | null
          response: string | null
          status: Database["public"]["Enums"]["medication_checkin_status"]
          updated_at: string
        }
        Insert: {
          checkin_type: Database["public"]["Enums"]["medication_checkin_type"]
          created_at?: string
          due_date: string
          id?: string
          medication_id: string
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          responded_at?: string | null
          response?: string | null
          status?: Database["public"]["Enums"]["medication_checkin_status"]
          updated_at?: string
        }
        Update: {
          checkin_type?: Database["public"]["Enums"]["medication_checkin_type"]
          created_at?: string
          due_date?: string
          id?: string
          medication_id?: string
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          responded_at?: string | null
          response?: string | null
          status?: Database["public"]["Enums"]["medication_checkin_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_adherence_checkins_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_adherence_checkins_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_adherence_checkins_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_lab_monitoring: {
        Row: {
          completed_at: string | null
          created_at: string
          drug_class: string
          due_date: string | null
          id: string
          medication_id: string
          monitoring_label: string
          notes: string | null
          organisation_id: string
          patient_id: string
          status: Database["public"]["Enums"]["lab_monitoring_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          drug_class: string
          due_date?: string | null
          id?: string
          medication_id: string
          monitoring_label: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          status?: Database["public"]["Enums"]["lab_monitoring_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          drug_class?: string
          due_date?: string | null
          id?: string
          medication_id?: string
          monitoring_label?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          status?: Database["public"]["Enums"]["lab_monitoring_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_lab_monitoring_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_lab_monitoring_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_lab_monitoring_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_logs: {
        Row: {
          created_at: string
          id: string
          logged_at: string
          logged_by_profile_id: string | null
          medication_id: string
          organisation_id: string
          patient_id: string
          reason: string | null
          scheduled_for_date: string | null
          scheduled_time: string | null
          status: Database["public"]["Enums"]["medication_log_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          logged_at?: string
          logged_by_profile_id?: string | null
          medication_id: string
          organisation_id: string
          patient_id: string
          reason?: string | null
          scheduled_for_date?: string | null
          scheduled_time?: string | null
          status: Database["public"]["Enums"]["medication_log_status"]
        }
        Update: {
          created_at?: string
          id?: string
          logged_at?: string
          logged_by_profile_id?: string | null
          medication_id?: string
          organisation_id?: string
          patient_id?: string
          reason?: string | null
          scheduled_for_date?: string | null
          scheduled_time?: string | null
          status?: Database["public"]["Enums"]["medication_log_status"]
        }
        Relationships: [
          {
            foreignKeyName: "medication_logs_logged_by_profile_id_fkey"
            columns: ["logged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_receipt_confirmations: {
        Row: {
          confirmation_source: string
          confirmed_by: string | null
          created_at: string
          id: string
          medication_id: string | null
          notes: string | null
          organisation_id: string
          patient_id: string
          pharmacy_order_dispense_id: string | null
          received_at: string
        }
        Insert: {
          confirmation_source?: string
          confirmed_by?: string | null
          created_at?: string
          id?: string
          medication_id?: string | null
          notes?: string | null
          organisation_id: string
          patient_id: string
          pharmacy_order_dispense_id?: string | null
          received_at?: string
        }
        Update: {
          confirmation_source?: string
          confirmed_by?: string | null
          created_at?: string
          id?: string
          medication_id?: string | null
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          pharmacy_order_dispense_id?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_receipt_confirmation_pharmacy_order_dispense_id_fkey"
            columns: ["pharmacy_order_dispense_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_order_dispenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_receipt_confirmations_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_receipt_confirmations_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_receipt_confirmations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_receipt_confirmations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_refill_reminder_rules: {
        Row: {
          created_at: string
          id: string
          lead_days: number
          organisation_id: string
          patient_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_days: number
          organisation_id: string
          patient_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_days?: number
          organisation_id?: string
          patient_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_refill_reminder_rules_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_refill_reminder_rules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_refill_state: {
        Row: {
          medication_id: string
          organisation_id: string
          patient_id: string
          reminded_for_refill_date: string
          reminder_sent_at: string
          updated_at: string
        }
        Insert: {
          medication_id: string
          organisation_id: string
          patient_id: string
          reminded_for_refill_date: string
          reminder_sent_at?: string
          updated_at?: string
        }
        Update: {
          medication_id?: string
          organisation_id?: string
          patient_id?: string
          reminded_for_refill_date?: string
          reminder_sent_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_refill_state_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: true
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_refill_state_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_refill_state_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_review_cadences: {
        Row: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          interval_months: number
        }
        Insert: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          interval_months: number
        }
        Update: {
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          interval_months?: number
        }
        Relationships: []
      }
      medication_reviews: {
        Row: {
          care_plan_id: string
          completed_at: string | null
          created_at: string
          due_date: string
          id: string
          notes: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["medication_review_status"]
          updated_at: string
        }
        Insert: {
          care_plan_id: string
          completed_at?: string | null
          created_at?: string
          due_date: string
          id?: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["medication_review_status"]
          updated_at?: string
        }
        Update: {
          care_plan_id?: string
          completed_at?: string | null
          created_at?: string
          due_date?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["medication_review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_reviews_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_reviews_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_reviews_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          added_by: string | null
          care_plan_id: string | null
          created_at: string
          dose: string | null
          drug_name: string
          frequency: string | null
          id: string
          is_active: boolean
          last_confirmed_at: string | null
          last_confirmed_by: string | null
          organisation_id: string
          patient_id: string
          prescriber_document_url: string | null
          prescriber_name: string | null
          refill_date: string | null
          schedule_times: Json
          source: Database["public"]["Enums"]["medication_source"]
          stopped_at: string | null
          stopped_reason: string | null
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          care_plan_id?: string | null
          created_at?: string
          dose?: string | null
          drug_name: string
          frequency?: string | null
          id?: string
          is_active?: boolean
          last_confirmed_at?: string | null
          last_confirmed_by?: string | null
          organisation_id: string
          patient_id: string
          prescriber_document_url?: string | null
          prescriber_name?: string | null
          refill_date?: string | null
          schedule_times?: Json
          source?: Database["public"]["Enums"]["medication_source"]
          stopped_at?: string | null
          stopped_reason?: string | null
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          care_plan_id?: string | null
          created_at?: string
          dose?: string | null
          drug_name?: string
          frequency?: string | null
          id?: string
          is_active?: boolean
          last_confirmed_at?: string | null
          last_confirmed_by?: string | null
          organisation_id?: string
          patient_id?: string
          prescriber_document_url?: string | null
          prescriber_name?: string | null
          refill_date?: string | null
          schedule_times?: Json
          source?: Database["public"]["Enums"]["medication_source"]
          stopped_at?: string | null
          stopped_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medications_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_last_confirmed_by_fkey"
            columns: ["last_confirmed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mental_health_screens: {
        Row: {
          created_at: string
          crisis_flagged: boolean
          hazardous: boolean | null
          id: string
          instrument: string
          item_responses: Json
          organisation_id: string
          patient_id: string
          severity_band: string
          total_score: number
        }
        Insert: {
          created_at?: string
          crisis_flagged?: boolean
          hazardous?: boolean | null
          id?: string
          instrument: string
          item_responses?: Json
          organisation_id: string
          patient_id: string
          severity_band: string
          total_score: number
        }
        Update: {
          created_at?: string
          crisis_flagged?: boolean
          hazardous?: boolean | null
          id?: string
          instrument?: string
          item_responses?: Json
          organisation_id?: string
          patient_id?: string
          severity_band?: string
          total_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "mental_health_screens_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mental_health_screens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mrr_snapshots: {
        Row: {
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          id: string
          mrr_minor: number
          plan_code: string | null
          snapshot_month: string
          subscriber_id: string
        }
        Insert: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          id?: string
          mrr_minor?: number
          plan_code?: string | null
          snapshot_month: string
          subscriber_id: string
        }
        Update: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          id?: string
          mrr_minor?: number
          plan_code?: string | null
          snapshot_month?: string
          subscriber_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mrr_snapshots_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_broadcasts: {
        Row: {
          audience: Database["public"]["Enums"]["broadcast_audience"]
          audience_filter: Json
          body: string
          channels: Database["public"]["Enums"]["notification_channel"][]
          created_at: string
          created_by: string
          id: string
          recipient_count: number
          sent_at: string | null
          status: Database["public"]["Enums"]["broadcast_status"]
          title: string
          updated_at: string
        }
        Insert: {
          audience: Database["public"]["Enums"]["broadcast_audience"]
          audience_filter?: Json
          body: string
          channels: Database["public"]["Enums"]["notification_channel"][]
          created_at?: string
          created_by: string
          id?: string
          recipient_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          title: string
          updated_at?: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["broadcast_audience"]
          audience_filter?: Json
          body?: string
          channels?: Database["public"]["Enums"]["notification_channel"][]
          created_at?: string
          created_by?: string
          id?: string
          recipient_count?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_broadcasts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_escalation_failures: {
        Row: {
          channel_sequence_exhausted: Database["public"]["Enums"]["notification_channel"][]
          created_at: string
          escalation_alert_tier: Database["public"]["Enums"]["alert_level"]
          escalation_pathway: string
          id: string
          notification_id: string
          organisation_id: string | null
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          channel_sequence_exhausted: Database["public"]["Enums"]["notification_channel"][]
          created_at?: string
          escalation_alert_tier: Database["public"]["Enums"]["alert_level"]
          escalation_pathway: string
          id?: string
          notification_id: string
          organisation_id?: string | null
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          channel_sequence_exhausted?: Database["public"]["Enums"]["notification_channel"][]
          created_at?: string
          escalation_alert_tier?: Database["public"]["Enums"]["alert_level"]
          escalation_pathway?: string
          id?: string
          notification_id?: string
          organisation_id?: string | null
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_escalation_failures_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_escalation_failures_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notification_channel"]
          content_class: Database["public"]["Enums"]["notification_content_class"]
          created_at: string
          delivered_at: string | null
          escalated_from_id: string | null
          escalation_alert_tier:
            | Database["public"]["Enums"]["alert_level"]
            | null
          escalation_hop: number
          escalation_pathway: string | null
          failed_at: string | null
          id: string
          last_error: string | null
          opened_at: string | null
          organisation_id: string | null
          payload: Json
          priority: Database["public"]["Enums"]["notification_priority"]
          provider_message_id: string | null
          recipient_id: string
          sent_at: string | null
          source_id: string | null
          source_table: string | null
          status: Database["public"]["Enums"]["notification_status"]
          template: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          content_class?: Database["public"]["Enums"]["notification_content_class"]
          created_at?: string
          delivered_at?: string | null
          escalated_from_id?: string | null
          escalation_alert_tier?:
            | Database["public"]["Enums"]["alert_level"]
            | null
          escalation_hop?: number
          escalation_pathway?: string | null
          failed_at?: string | null
          id?: string
          last_error?: string | null
          opened_at?: string | null
          organisation_id?: string | null
          payload?: Json
          priority?: Database["public"]["Enums"]["notification_priority"]
          provider_message_id?: string | null
          recipient_id: string
          sent_at?: string | null
          source_id?: string | null
          source_table?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          content_class?: Database["public"]["Enums"]["notification_content_class"]
          created_at?: string
          delivered_at?: string | null
          escalated_from_id?: string | null
          escalation_alert_tier?:
            | Database["public"]["Enums"]["alert_level"]
            | null
          escalation_hop?: number
          escalation_pathway?: string | null
          failed_at?: string | null
          id?: string
          last_error?: string | null
          opened_at?: string | null
          organisation_id?: string | null
          payload?: Json
          priority?: Database["public"]["Enums"]["notification_priority"]
          provider_message_id?: string | null
          recipient_id?: string
          sent_at?: string | null
          source_id?: string | null
          source_table?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_escalated_from_id_fkey"
            columns: ["escalated_from_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_log_entries: {
        Row: {
          ai_estimate: Json | null
          ai_status: string
          confirmed_carbs_g: number | null
          confirmed_sodium_mg: number | null
          created_at: string
          description: string | null
          id: string
          logged_at: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          organisation_id: string
          patient_confirmed: boolean
          patient_id: string
          photo_path: string | null
          updated_at: string
        }
        Insert: {
          ai_estimate?: Json | null
          ai_status?: string
          confirmed_carbs_g?: number | null
          confirmed_sodium_mg?: number | null
          created_at?: string
          description?: string | null
          id?: string
          logged_at?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          organisation_id: string
          patient_confirmed?: boolean
          patient_id: string
          photo_path?: string | null
          updated_at?: string
        }
        Update: {
          ai_estimate?: Json | null
          ai_status?: string
          confirmed_carbs_g?: number | null
          confirmed_sodium_mg?: number | null
          created_at?: string
          description?: string | null
          id?: string
          logged_at?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          organisation_id?: string
          patient_confirmed?: boolean
          patient_id?: string
          photo_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_log_entries_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_log_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      obesity_assessments: {
        Row: {
          adiposity_confirmed: boolean | null
          assessed_at: string
          assessed_by: string | null
          bmi: number
          bmi_category: Database["public"]["Enums"]["obesity_bmi_category"]
          clinical_status:
            | Database["public"]["Enums"]["obesity_clinical_status"]
            | null
          complications: Json
          created_at: string
          eoss_stage: number | null
          functional_limitation: boolean
          height_cm: number
          id: string
          notes: string | null
          organisation_id: string
          patient_id: string
          secondary_causes: Json
          updated_at: string
          waist_cm: number | null
          waist_risk: Database["public"]["Enums"]["obesity_waist_risk"] | null
          weight_kg: number
          whtr: number | null
        }
        Insert: {
          adiposity_confirmed?: boolean | null
          assessed_at?: string
          assessed_by?: string | null
          bmi: number
          bmi_category: Database["public"]["Enums"]["obesity_bmi_category"]
          clinical_status?:
            | Database["public"]["Enums"]["obesity_clinical_status"]
            | null
          complications?: Json
          created_at?: string
          eoss_stage?: number | null
          functional_limitation?: boolean
          height_cm: number
          id?: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          secondary_causes?: Json
          updated_at?: string
          waist_cm?: number | null
          waist_risk?: Database["public"]["Enums"]["obesity_waist_risk"] | null
          weight_kg: number
          whtr?: number | null
        }
        Update: {
          adiposity_confirmed?: boolean | null
          assessed_at?: string
          assessed_by?: string | null
          bmi?: number
          bmi_category?: Database["public"]["Enums"]["obesity_bmi_category"]
          clinical_status?:
            | Database["public"]["Enums"]["obesity_clinical_status"]
            | null
          complications?: Json
          created_at?: string
          eoss_stage?: number | null
          functional_limitation?: boolean
          height_cm?: number
          id?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          secondary_causes?: Json
          updated_at?: string
          waist_cm?: number | null
          waist_risk?: Database["public"]["Enums"]["obesity_waist_risk"] | null
          weight_kg?: number
          whtr?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "obesity_assessments_assessed_by_fkey"
            columns: ["assessed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obesity_assessments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obesity_assessments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      obesity_ed_screens: {
        Row: {
          administered_by: string | null
          clinician_alert_id: string | null
          created_at: string
          disordered_behaviours: Json
          id: string
          low_mood: boolean
          notes: string | null
          organisation_id: string
          patient_id: string
          positive: boolean
          scoff_control: boolean
          scoff_fat: boolean
          scoff_food_dominates: boolean
          scoff_one_stone: boolean
          scoff_score: number
          scoff_sick: boolean
          screened_at: string
          self_harm_risk: boolean
          self_reported: boolean
        }
        Insert: {
          administered_by?: string | null
          clinician_alert_id?: string | null
          created_at?: string
          disordered_behaviours?: Json
          id?: string
          low_mood?: boolean
          notes?: string | null
          organisation_id: string
          patient_id: string
          positive?: boolean
          scoff_control?: boolean
          scoff_fat?: boolean
          scoff_food_dominates?: boolean
          scoff_one_stone?: boolean
          scoff_score?: number
          scoff_sick?: boolean
          screened_at?: string
          self_harm_risk?: boolean
          self_reported?: boolean
        }
        Update: {
          administered_by?: string | null
          clinician_alert_id?: string | null
          created_at?: string
          disordered_behaviours?: Json
          id?: string
          low_mood?: boolean
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          positive?: boolean
          scoff_control?: boolean
          scoff_fat?: boolean
          scoff_food_dominates?: boolean
          scoff_one_stone?: boolean
          scoff_score?: number
          scoff_sick?: boolean
          screened_at?: string
          self_harm_risk?: boolean
          self_reported?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "obesity_ed_screens_administered_by_fkey"
            columns: ["administered_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obesity_ed_screens_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obesity_ed_screens_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obesity_ed_screens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          metadata: Json
          min_cohort_size: number
          name: string
          type: Database["public"]["Enums"]["organisation_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          min_cohort_size?: number
          name: string
          type: Database["public"]["Enums"]["organisation_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          min_cohort_size?: number
          name?: string
          type?: Database["public"]["Enums"]["organisation_type"]
          updated_at?: string
        }
        Relationships: []
      }
      outcome_reports: {
        Row: {
          generated_at: string
          generated_by: string | null
          id: string
          organisation_id: string
          period_end: string
          period_start: string
          published: boolean
          snapshot: Json
        }
        Insert: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          organisation_id: string
          period_end: string
          period_start: string
          published?: boolean
          snapshot: Json
        }
        Update: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          organisation_id?: string
          period_end?: string
          period_start?: string
          published?: boolean
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "outcome_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_reports_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      outcomes_contracts: {
        Row: {
          contract_type: Database["public"]["Enums"]["outcomes_contract_type"]
          created_at: string
          effective_from: string
          id: string
          organisation_id: string
          outcome_thresholds: Json
          payout_terms: string | null
        }
        Insert: {
          contract_type: Database["public"]["Enums"]["outcomes_contract_type"]
          created_at?: string
          effective_from?: string
          id?: string
          organisation_id: string
          outcome_thresholds?: Json
          payout_terms?: string | null
        }
        Update: {
          contract_type?: Database["public"]["Enums"]["outcomes_contract_type"]
          created_at?: string
          effective_from?: string
          id?: string
          organisation_id?: string
          outcome_thresholds?: Json
          payout_terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_contracts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      panel_bundles: {
        Row: {
          code: string
          commission_flat_kobo: number | null
          commission_rate: number | null
          commission_rate_type: Database["public"]["Enums"]["commission_rate_type"]
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_screen_tier: boolean
          name: string
          price_kobo: number
          review_discount_bp: number
          self_bookable: boolean
          test_codes: string[]
        }
        Insert: {
          code: string
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_screen_tier?: boolean
          name: string
          price_kobo?: number
          review_discount_bp?: number
          self_bookable?: boolean
          test_codes?: string[]
        }
        Update: {
          code?: string
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_screen_tier?: boolean
          name?: string
          price_kobo?: number
          review_discount_bp?: number
          self_bookable?: boolean
          test_codes?: string[]
        }
        Relationships: []
      }
      partner_integrations: {
        Row: {
          auth_header: string
          base_url: string
          created_at: string
          id: string
          is_active: boolean
          last_check_ok: boolean | null
          last_checked_at: string | null
          name: string
          notes: string | null
          organisation_id: string
          secret: string | null
          updated_at: string
        }
        Insert: {
          auth_header?: string
          base_url: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_check_ok?: boolean | null
          last_checked_at?: string | null
          name: string
          notes?: string | null
          organisation_id: string
          secret?: string | null
          updated_at?: string
        }
        Update: {
          auth_header?: string
          base_url?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_check_ok?: boolean | null
          last_checked_at?: string | null
          name?: string
          notes?: string | null
          organisation_id?: string
          secret?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_integrations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_license_expiry_notifications: {
        Row: {
          created_at: string
          id: string
          notified_on: string
          partner_id: string
          partner_table: string
        }
        Insert: {
          created_at?: string
          id?: string
          notified_on?: string
          partner_id: string
          partner_table: string
        }
        Update: {
          created_at?: string
          id?: string
          notified_on?: string
          partner_id?: string
          partner_table?: string
        }
        Relationships: []
      }
      partner_statement_lines: {
        Row: {
          created_at: string
          expected_kobo: number | null
          id: string
          invoiced_kobo: number
          lab_order_id: string | null
          partner_reference: string | null
          resolution: Database["public"]["Enums"]["partner_statement_line_resolution"]
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          screen_type_code: string | null
          statement_id: string
        }
        Insert: {
          created_at?: string
          expected_kobo?: number | null
          id?: string
          invoiced_kobo: number
          lab_order_id?: string | null
          partner_reference?: string | null
          resolution?: Database["public"]["Enums"]["partner_statement_line_resolution"]
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screen_type_code?: string | null
          statement_id: string
        }
        Update: {
          created_at?: string
          expected_kobo?: number | null
          id?: string
          invoiced_kobo?: number
          lab_order_id?: string | null
          partner_reference?: string | null
          resolution?: Database["public"]["Enums"]["partner_statement_line_resolution"]
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screen_type_code?: string | null
          statement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_statement_lines_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_statement_lines_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_statement_lines_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_statement_lines_screen_type_code_fkey"
            columns: ["screen_type_code"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "partner_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "partner_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_statements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bill_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          expected_total_kobo: number | null
          id: string
          invoiced_total_kobo: number
          matched_at: string | null
          note: string | null
          organisation_id: string
          period_end: string
          period_start: string
          provider_id: string
          received_at: string
          reference: string
          settled_at: string | null
          status: Database["public"]["Enums"]["partner_statement_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bill_id?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          expected_total_kobo?: number | null
          id?: string
          invoiced_total_kobo: number
          matched_at?: string | null
          note?: string | null
          organisation_id: string
          period_end: string
          period_start: string
          provider_id: string
          received_at?: string
          reference: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["partner_statement_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bill_id?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          expected_total_kobo?: number | null
          id?: string
          invoiced_total_kobo?: number
          matched_at?: string | null
          note?: string | null
          organisation_id?: string
          period_end?: string
          period_start?: string
          provider_id?: string
          received_at?: string
          reference?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["partner_statement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_statements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_statements_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "finance_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_statements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_statements_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "lab_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      passport_signing_keys: {
        Row: {
          activated_at: string | null
          algorithm: string
          created_at: string
          kid: string
          public_key_spki: string
          retired_at: string | null
        }
        Insert: {
          activated_at?: string | null
          algorithm?: string
          created_at?: string
          kid: string
          public_key_spki: string
          retired_at?: string | null
        }
        Update: {
          activated_at?: string | null
          algorithm?: string
          created_at?: string
          kid?: string
          public_key_spki?: string
          retired_at?: string | null
        }
        Relationships: []
      }
      pathway_attestations: {
        Row: {
          attested_at: string
          clinical_staff_id: string
          created_at: string
          id: string
          organisation_id: string
          pathway_version: number
          protocol_slug: string
          statement: string
        }
        Insert: {
          attested_at?: string
          clinical_staff_id: string
          created_at?: string
          id?: string
          organisation_id: string
          pathway_version?: number
          protocol_slug: string
          statement: string
        }
        Update: {
          attested_at?: string
          clinical_staff_id?: string
          created_at?: string
          id?: string
          organisation_id?: string
          pathway_version?: number
          protocol_slug?: string
          statement?: string
        }
        Relationships: [
          {
            foreignKeyName: "pathway_attestations_clinical_staff_id_fkey"
            columns: ["clinical_staff_id"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pathway_attestations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_activity_goals: {
        Row: {
          created_at: string
          daily_step_goal: number
          id: string
          organisation_id: string
          patient_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_step_goal?: number
          id?: string
          organisation_id: string
          patient_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_step_goal?: number
          id?: string
          organisation_id?: string
          patient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_activity_goals_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_activity_goals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_allergies: {
        Row: {
          allergen: string
          created_at: string
          id: string
          noted_at: string
          organisation_id: string
          patient_id: string
          reaction: string | null
          recorded_by: string | null
          severity: Database["public"]["Enums"]["allergy_severity"] | null
          source: Database["public"]["Enums"]["allergy_source"]
          updated_at: string
        }
        Insert: {
          allergen: string
          created_at?: string
          id?: string
          noted_at?: string
          organisation_id: string
          patient_id: string
          reaction?: string | null
          recorded_by?: string | null
          severity?: Database["public"]["Enums"]["allergy_severity"] | null
          source?: Database["public"]["Enums"]["allergy_source"]
          updated_at?: string
        }
        Update: {
          allergen?: string
          created_at?: string
          id?: string
          noted_at?: string
          organisation_id?: string
          patient_id?: string
          reaction?: string | null
          recorded_by?: string | null
          severity?: Database["public"]["Enums"]["allergy_severity"] | null
          source?: Database["public"]["Enums"]["allergy_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_allergies_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_allergies_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_allergies_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_blood_profile: {
        Row: {
          attestation_version: string | null
          attested_at: string | null
          blood_group: Database["public"]["Enums"]["blood_group"] | null
          document_id: string | null
          genotype: Database["public"]["Enums"]["haemoglobin_genotype"] | null
          genotype_note: string | null
          organisation_id: string
          patient_id: string
          provenance: string
          recorded_at: string
          recorded_by: string | null
          updated_at: string
        }
        Insert: {
          attestation_version?: string | null
          attested_at?: string | null
          blood_group?: Database["public"]["Enums"]["blood_group"] | null
          document_id?: string | null
          genotype?: Database["public"]["Enums"]["haemoglobin_genotype"] | null
          genotype_note?: string | null
          organisation_id: string
          patient_id: string
          provenance: string
          recorded_at?: string
          recorded_by?: string | null
          updated_at?: string
        }
        Update: {
          attestation_version?: string | null
          attested_at?: string | null
          blood_group?: Database["public"]["Enums"]["blood_group"] | null
          document_id?: string | null
          genotype?: Database["public"]["Enums"]["haemoglobin_genotype"] | null
          genotype_note?: string | null
          organisation_id?: string
          patient_id?: string
          provenance?: string
          recorded_at?: string
          recorded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_blood_profile_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "lab_result_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_blood_profile_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_blood_profile_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_blood_profile_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_bp_targets: {
        Row: {
          category: string
          created_at: string
          home_diastolic: number
          home_systolic: number
          id: string
          office_diastolic: number
          office_systolic: number
          organisation_id: string
          patient_id: string
          rationale: string | null
          set_by: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          home_diastolic: number
          home_systolic: number
          id?: string
          office_diastolic: number
          office_systolic: number
          organisation_id: string
          patient_id: string
          rationale?: string | null
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          home_diastolic?: number
          home_systolic?: number
          id?: string
          office_diastolic?: number
          office_systolic?: number
          organisation_id?: string
          patient_id?: string
          rationale?: string | null
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_bp_targets_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_bp_targets_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_bp_targets_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_cardiovascular_profile: {
        Row: {
          created_at: string
          established_ascvd: boolean
          familial_hypercholesterolaemia: boolean
          id: string
          notes: string | null
          organisation_id: string
          patient_id: string
          prior_mi: boolean
          prior_pad: boolean
          prior_revascularisation: boolean
          prior_stroke_tia: boolean
          recorded_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          established_ascvd?: boolean
          familial_hypercholesterolaemia?: boolean
          id?: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          prior_mi?: boolean
          prior_pad?: boolean
          prior_revascularisation?: boolean
          prior_stroke_tia?: boolean
          recorded_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          established_ascvd?: boolean
          familial_hypercholesterolaemia?: boolean
          id?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          prior_mi?: boolean
          prior_pad?: boolean
          prior_revascularisation?: boolean
          prior_stroke_tia?: boolean
          recorded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_cardiovascular_profile_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_cardiovascular_profile_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_cardiovascular_profile_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_challenge_enrolments: {
        Row: {
          challenge_id: string
          completed_at: string | null
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          started_at: string
          status: Database["public"]["Enums"]["wellness_challenge_status"]
          target_end_at: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["wellness_challenge_status"]
          target_end_at: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["wellness_challenge_status"]
          target_end_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_challenge_enrolments_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "wellness_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_challenge_enrolments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_challenge_enrolments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_conditions: {
        Row: {
          condition_name: string
          created_at: string
          current_treatment: string | null
          date_identified: string | null
          diagnosing_clinician_id: string | null
          icd10_code: string | null
          id: string
          last_reviewed_at: string | null
          next_review_due_at: string | null
          organisation_id: string
          patient_id: string
          recorded_by: string | null
          severity: Database["public"]["Enums"]["clinical_severity"] | null
          status: Database["public"]["Enums"]["condition_clinical_status"]
          supporting_evidence: string | null
          updated_at: string
        }
        Insert: {
          condition_name: string
          created_at?: string
          current_treatment?: string | null
          date_identified?: string | null
          diagnosing_clinician_id?: string | null
          icd10_code?: string | null
          id?: string
          last_reviewed_at?: string | null
          next_review_due_at?: string | null
          organisation_id: string
          patient_id: string
          recorded_by?: string | null
          severity?: Database["public"]["Enums"]["clinical_severity"] | null
          status?: Database["public"]["Enums"]["condition_clinical_status"]
          supporting_evidence?: string | null
          updated_at?: string
        }
        Update: {
          condition_name?: string
          created_at?: string
          current_treatment?: string | null
          date_identified?: string | null
          diagnosing_clinician_id?: string | null
          icd10_code?: string | null
          id?: string
          last_reviewed_at?: string | null
          next_review_due_at?: string | null
          organisation_id?: string
          patient_id?: string
          recorded_by?: string | null
          severity?: Database["public"]["Enums"]["clinical_severity"] | null
          status?: Database["public"]["Enums"]["condition_clinical_status"]
          supporting_evidence?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_conditions_diagnosing_clinician_id_fkey"
            columns: ["diagnosing_clinician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_conditions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_conditions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_conditions_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_consents: {
        Row: {
          accepted_at: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          consent_version_id: string
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          consent_version_id: string
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          consent_type?: Database["public"]["Enums"]["consent_type"]
          consent_version_id?: string
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_consents_consent_version_id_fkey"
            columns: ["consent_version_id"]
            isOneToOne: false
            referencedRelation: "consent_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_consents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_consents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_devices: {
        Row: {
          ble_device_id: string
          created_at: string
          device_type: Database["public"]["Enums"]["patient_device_type"]
          id: string
          last_synced_at: string | null
          manufacturer: string | null
          model: string | null
          nickname: string | null
          organisation_id: string
          paired_at: string
          patient_id: string
          status: Database["public"]["Enums"]["patient_device_status"]
        }
        Insert: {
          ble_device_id: string
          created_at?: string
          device_type: Database["public"]["Enums"]["patient_device_type"]
          id?: string
          last_synced_at?: string | null
          manufacturer?: string | null
          model?: string | null
          nickname?: string | null
          organisation_id: string
          paired_at?: string
          patient_id: string
          status?: Database["public"]["Enums"]["patient_device_status"]
        }
        Update: {
          ble_device_id?: string
          created_at?: string
          device_type?: Database["public"]["Enums"]["patient_device_type"]
          id?: string
          last_synced_at?: string | null
          manufacturer?: string | null
          model?: string | null
          nickname?: string | null
          organisation_id?: string
          paired_at?: string
          patient_id?: string
          status?: Database["public"]["Enums"]["patient_device_status"]
        }
        Relationships: [
          {
            foreignKeyName: "patient_devices_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_devices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_diabetes_profile: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_type: Database["public"]["Enums"]["diabetes_type"] | null
          created_at: string
          organisation_id: string
          patient_id: string
          patient_reported_type:
            | Database["public"]["Enums"]["diabetes_type"]
            | null
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_type?: Database["public"]["Enums"]["diabetes_type"] | null
          created_at?: string
          organisation_id: string
          patient_id: string
          patient_reported_type?:
            | Database["public"]["Enums"]["diabetes_type"]
            | null
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_type?: Database["public"]["Enums"]["diabetes_type"] | null
          created_at?: string
          organisation_id?: string
          patient_id?: string
          patient_reported_type?:
            | Database["public"]["Enums"]["diabetes_type"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_diabetes_profile_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_diabetes_profile_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_diabetes_profile_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_exposure_reports: {
        Row: {
          created_at: string
          detail: string | null
          emergency_event_id: string | null
          exposure_code: string
          id: string
          occurred_on: string | null
          organisation_id: string
          patient_id: string
          reported_at: string
          reported_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["exposure_report_status"]
        }
        Insert: {
          created_at?: string
          detail?: string | null
          emergency_event_id?: string | null
          exposure_code: string
          id?: string
          occurred_on?: string | null
          organisation_id: string
          patient_id: string
          reported_at?: string
          reported_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["exposure_report_status"]
        }
        Update: {
          created_at?: string
          detail?: string | null
          emergency_event_id?: string | null
          exposure_code?: string
          id?: string
          occurred_on?: string | null
          organisation_id?: string
          patient_id?: string
          reported_at?: string
          reported_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["exposure_report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "patient_exposure_reports_emergency_event_id_fkey"
            columns: ["emergency_event_id"]
            isOneToOne: false
            referencedRelation: "emergency_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_exposure_reports_exposure_code_fkey"
            columns: ["exposure_code"]
            isOneToOne: false
            referencedRelation: "exposure_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "patient_exposure_reports_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_exposure_reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_exposure_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_exposure_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_glucose_targets: {
        Row: {
          category: Database["public"]["Enums"]["glycaemic_target_category"]
          control_state_override:
            | Database["public"]["Enums"]["chronic_control_state"]
            | null
          control_state_override_at: string | null
          control_state_override_by: string | null
          control_state_override_reason: string | null
          created_at: string
          fasting_max: number
          fasting_min: number
          hba1c_target_percent: number | null
          id: string
          note: string | null
          organisation_id: string
          patient_id: string
          set_by: string | null
          updated_at: string
          upper_target: number
        }
        Insert: {
          category?: Database["public"]["Enums"]["glycaemic_target_category"]
          control_state_override?:
            | Database["public"]["Enums"]["chronic_control_state"]
            | null
          control_state_override_at?: string | null
          control_state_override_by?: string | null
          control_state_override_reason?: string | null
          created_at?: string
          fasting_max?: number
          fasting_min?: number
          hba1c_target_percent?: number | null
          id?: string
          note?: string | null
          organisation_id: string
          patient_id: string
          set_by?: string | null
          updated_at?: string
          upper_target?: number
        }
        Update: {
          category?: Database["public"]["Enums"]["glycaemic_target_category"]
          control_state_override?:
            | Database["public"]["Enums"]["chronic_control_state"]
            | null
          control_state_override_at?: string | null
          control_state_override_by?: string | null
          control_state_override_reason?: string | null
          created_at?: string
          fasting_max?: number
          fasting_min?: number
          hba1c_target_percent?: number | null
          id?: string
          note?: string | null
          organisation_id?: string
          patient_id?: string
          set_by?: string | null
          updated_at?: string
          upper_target?: number
        }
        Relationships: [
          {
            foreignKeyName: "patient_glucose_targets_control_state_override_by_fkey"
            columns: ["control_state_override_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_glucose_targets_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_glucose_targets_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_glucose_targets_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_health_resets: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          started_at: string
          trial_claimed_at: string | null
          trial_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          started_at?: string
          trial_claimed_at?: string | null
          trial_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          started_at?: string
          trial_claimed_at?: string | null
          trial_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_health_resets_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_health_resets_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_health_resets_trial_subscription_id_fkey"
            columns: ["trial_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_hospital_admissions: {
        Row: {
          admitted_on: string
          clinician_alert_id: string | null
          created_at: string
          discharge_review_alert_id: string | null
          discharge_summary: string | null
          discharged_on: string | null
          emergency_event_id: string | null
          facility_id: string | null
          facility_name: string | null
          id: string
          is_current: boolean | null
          logged_by_profile_id: string | null
          organisation_id: string
          patient_id: string
          reason: string | null
          recorded_by: string | null
          self_reported_diagnosis: string | null
          source: Database["public"]["Enums"]["hospital_admission_source"]
          updated_at: string
        }
        Insert: {
          admitted_on: string
          clinician_alert_id?: string | null
          created_at?: string
          discharge_review_alert_id?: string | null
          discharge_summary?: string | null
          discharged_on?: string | null
          emergency_event_id?: string | null
          facility_id?: string | null
          facility_name?: string | null
          id?: string
          is_current?: boolean | null
          logged_by_profile_id?: string | null
          organisation_id: string
          patient_id: string
          reason?: string | null
          recorded_by?: string | null
          self_reported_diagnosis?: string | null
          source?: Database["public"]["Enums"]["hospital_admission_source"]
          updated_at?: string
        }
        Update: {
          admitted_on?: string
          clinician_alert_id?: string | null
          created_at?: string
          discharge_review_alert_id?: string | null
          discharge_summary?: string | null
          discharged_on?: string | null
          emergency_event_id?: string | null
          facility_id?: string | null
          facility_name?: string | null
          id?: string
          is_current?: boolean | null
          logged_by_profile_id?: string | null
          organisation_id?: string
          patient_id?: string
          reason?: string | null
          recorded_by?: string | null
          self_reported_diagnosis?: string | null
          source?: Database["public"]["Enums"]["hospital_admission_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_hospital_admissions_clinician_alert_id_fkey"
            columns: ["clinician_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_hospital_admissions_discharge_review_alert_id_fkey"
            columns: ["discharge_review_alert_id"]
            isOneToOne: false
            referencedRelation: "clinician_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_hospital_admissions_emergency_event_id_fkey"
            columns: ["emergency_event_id"]
            isOneToOne: false
            referencedRelation: "emergency_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_hospital_admissions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_hospital_admissions_logged_by_profile_id_fkey"
            columns: ["logged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_hospital_admissions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_hospital_admissions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_hospital_admissions_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_pregnancy: {
        Row: {
          created_at: string
          estimated_due_date: string | null
          id: string
          is_pregnant: boolean
          organisation_id: string
          patient_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          estimated_due_date?: string | null
          id?: string
          is_pregnant?: boolean
          organisation_id: string
          patient_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          estimated_due_date?: string | null
          id?: string
          is_pregnant?: boolean
          organisation_id?: string
          patient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_pregnancy_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_pregnancy_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_quarterly_reports: {
        Row: {
          generated_at: string
          id: string
          organisation_id: string
          patient_id: string
          period_end: string
          period_start: string
          snapshot: Json
        }
        Insert: {
          generated_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          period_end: string
          period_start: string
          snapshot: Json
        }
        Update: {
          generated_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          period_end?: string
          period_start?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "patient_quarterly_reports_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_quarterly_reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_result_explanations: {
        Row: {
          created_at: string
          error_message: string | null
          explanation_text: string | null
          generated_at: string
          id: string
          input_snapshot: Json
          kind: string
          language: string
          model_id: string | null
          organisation_id: string
          patient_id: string
          status: string
          subject_key: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          explanation_text?: string | null
          generated_at?: string
          id?: string
          input_snapshot?: Json
          kind: string
          language?: string
          model_id?: string | null
          organisation_id: string
          patient_id: string
          status: string
          subject_key: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          explanation_text?: string | null
          generated_at?: string
          id?: string
          input_snapshot?: Json
          kind?: string
          language?: string
          model_id?: string | null
          organisation_id?: string
          patient_id?: string
          status?: string
          subject_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_result_explanations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_result_explanations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_risk_scores: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          inputs: Json
          model_version: string | null
          organisation_id: string
          patient_id: string
          risk_level: Database["public"]["Enums"]["risk_level"] | null
          score: number | null
          score_type: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          inputs?: Json
          model_version?: string | null
          organisation_id: string
          patient_id: string
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          score?: number | null
          score_type: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          inputs?: Json
          model_version?: string | null
          organisation_id?: string
          patient_id?: string
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          score?: number | null
          score_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_risk_scores_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_risk_scores_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_shared_decisions: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          organisation_id: string
          patient_id: string
          recorded_by: string | null
          screen_type_code: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          recorded_by?: string | null
          screen_type_code: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          recorded_by?: string | null
          screen_type_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_shared_decisions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_shared_decisions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_shared_decisions_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_shared_decisions_screen_type_code_fkey"
            columns: ["screen_type_code"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["code"]
          },
        ]
      }
      patient_testimonials: {
        Row: {
          consent_to_publish: boolean
          created_at: string
          display_name: string
          id: string
          organisation_id: string
          patient_id: string
          quote: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          consent_to_publish?: boolean
          created_at?: string
          display_name: string
          id?: string
          organisation_id: string
          patient_id: string
          quote: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          consent_to_publish?: boolean
          created_at?: string
          display_name?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          quote?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_testimonials_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_testimonials_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_testimonials_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_timeline: {
        Row: {
          actor_clinical_staff_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["timeline_event_type"]
          id: string
          metadata: Json
          occurred_at: string
          organisation_id: string
          patient_id: string
          source_id: string | null
          source_table: string
          summary: string | null
          title: string
        }
        Insert: {
          actor_clinical_staff_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["timeline_event_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          organisation_id: string
          patient_id: string
          source_id?: string | null
          source_table: string
          summary?: string | null
          title: string
        }
        Update: {
          actor_clinical_staff_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["timeline_event_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          organisation_id?: string
          patient_id?: string
          source_id?: string | null
          source_table?: string
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_timeline_actor_clinical_staff_id_fkey"
            columns: ["actor_clinical_staff_id"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_timeline_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_timeline_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_weight_goals: {
        Row: {
          created_at: string
          goal_weight_kg: number
          id: string
          organisation_id: string
          patient_id: string
          started_at: string
          starting_weight_kg: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          goal_weight_kg: number
          id?: string
          organisation_id: string
          patient_id: string
          started_at?: string
          starting_weight_kg: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          goal_weight_kg?: number
          id?: string
          organisation_id?: string
          patient_id?: string
          started_at?: string
          starting_weight_kg?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_weight_goals_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_weight_goals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_wellness_badges: {
        Row: {
          awarded_at: string
          badge_id: string
          id: string
          organisation_id: string
          patient_id: string
        }
        Insert: {
          awarded_at?: string
          badge_id: string
          id?: string
          organisation_id: string
          patient_id: string
        }
        Update: {
          awarded_at?: string
          badge_id?: string
          id?: string
          organisation_id?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_wellness_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "wellness_badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_wellness_badges_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_wellness_badges_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconciliation_flags: {
        Row: {
          created_at: string
          currency: Database["public"]["Enums"]["currency"] | null
          detail: Json
          detected_at: string
          flag_type: string
          id: string
          local_amount_minor: number | null
          local_status: string | null
          organisation_id: string | null
          payment_transaction_id: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_amount_minor: number | null
          provider_reference: string
          provider_status: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_note: string | null
          status: string
        }
        Insert: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"] | null
          detail?: Json
          detected_at?: string
          flag_type: string
          id?: string
          local_amount_minor?: number | null
          local_status?: string | null
          organisation_id?: string | null
          payment_transaction_id?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_amount_minor?: number | null
          provider_reference: string
          provider_status?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"] | null
          detail?: Json
          detected_at?: string
          flag_type?: string
          id?: string
          local_amount_minor?: number | null
          local_status?: string | null
          organisation_id?: string | null
          payment_transaction_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_amount_minor?: number | null
          provider_reference?: string
          provider_status?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_flags_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_flags_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_flags_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_minor: number | null
          booking_order_id: string | null
          booking_order_type:
            | Database["public"]["Enums"]["commission_type"]
            | null
          created_at: string
          currency: Database["public"]["Enums"]["currency"] | null
          error: string | null
          event_type: Database["public"]["Enums"]["payment_transaction_type"]
          id: string
          organisation_id: string | null
          processed_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_event_id: string
          raw_payload: Json
          subscription_add_on_id: string | null
          subscription_id: string | null
        }
        Insert: {
          amount_minor?: number | null
          booking_order_id?: string | null
          booking_order_type?:
            | Database["public"]["Enums"]["commission_type"]
            | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"] | null
          error?: string | null
          event_type?: Database["public"]["Enums"]["payment_transaction_type"]
          id?: string
          organisation_id?: string | null
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_event_id: string
          raw_payload?: Json
          subscription_add_on_id?: string | null
          subscription_id?: string | null
        }
        Update: {
          amount_minor?: number | null
          booking_order_id?: string | null
          booking_order_type?:
            | Database["public"]["Enums"]["commission_type"]
            | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"] | null
          error?: string | null
          event_type?: Database["public"]["Enums"]["payment_transaction_type"]
          id?: string
          organisation_id?: string | null
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_event_id?: string
          raw_payload?: Json
          subscription_add_on_id?: string | null
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_subscription_add_on_id_fkey"
            columns: ["subscription_add_on_id"]
            isOneToOne: false
            referencedRelation: "subscription_add_ons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          description: string | null
          key: string
          label: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          key: string
          label: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          key?: string
          label?: string
        }
        Relationships: []
      }
      pharmacy_medications: {
        Row: {
          commission_flat_kobo: number | null
          commission_rate: number | null
          commission_rate_type: Database["public"]["Enums"]["commission_rate_type"]
          created_at: string
          drug_name: string
          id: string
          is_active: boolean
          pack_size: string | null
          pharmacy_partner_id: string
          price_kobo: number
        }
        Insert: {
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          created_at?: string
          drug_name: string
          id?: string
          is_active?: boolean
          pack_size?: string | null
          pharmacy_partner_id: string
          price_kobo?: number
        }
        Update: {
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          created_at?: string
          drug_name?: string
          id?: string
          is_active?: boolean
          pack_size?: string | null
          pharmacy_partner_id?: string
          price_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_medications_pharmacy_partner_id_fkey"
            columns: ["pharmacy_partner_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_order_dispenses: {
        Row: {
          created_at: string
          dispensed_on: string
          drug_name: string
          id: string
          medication_id: string | null
          organisation_id: string
          patient_id: string
          pharmacy_name: string | null
          pharmacy_order_id: string | null
          quantity: string | null
          recorded_by: string | null
          source: Database["public"]["Enums"]["dispense_source"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          dispensed_on?: string
          drug_name: string
          id?: string
          medication_id?: string | null
          organisation_id: string
          patient_id: string
          pharmacy_name?: string | null
          pharmacy_order_id?: string | null
          quantity?: string | null
          recorded_by?: string | null
          source?: Database["public"]["Enums"]["dispense_source"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          dispensed_on?: string
          drug_name?: string
          id?: string
          medication_id?: string | null
          organisation_id?: string
          patient_id?: string
          pharmacy_name?: string | null
          pharmacy_order_id?: string | null
          quantity?: string | null
          recorded_by?: string | null
          source?: Database["public"]["Enums"]["dispense_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_order_dispenses_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_order_dispenses_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_order_dispenses_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_order_dispenses_pharmacy_order_id_fkey"
            columns: ["pharmacy_order_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_order_dispenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_orders: {
        Row: {
          applied_voucher_id: string | null
          courier_reference: string | null
          created_at: string
          delivered_at: string | null
          delivery_address: Json | null
          delivery_confirmed_at: string | null
          estimated_delivery_at: string | null
          fulfilment_method: Database["public"]["Enums"]["pharmacy_fulfilment_method"]
          id: string
          items: Json
          logistics_partner_id: string | null
          order_number: string | null
          ordered_by: string | null
          organisation_id: string
          origin: Database["public"]["Enums"]["booking_origin"]
          patient_id: string
          payable_kobo: number | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          pharmacy_partner_id: string | null
          requested_at: string
          status: Database["public"]["Enums"]["pharmacy_order_status"]
          total_kobo: number
          updated_at: string
          voucher_covered_kobo: number
        }
        Insert: {
          applied_voucher_id?: string | null
          courier_reference?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_address?: Json | null
          delivery_confirmed_at?: string | null
          estimated_delivery_at?: string | null
          fulfilment_method?: Database["public"]["Enums"]["pharmacy_fulfilment_method"]
          id?: string
          items?: Json
          logistics_partner_id?: string | null
          order_number?: string | null
          ordered_by?: string | null
          organisation_id: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          patient_id: string
          payable_kobo?: number | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          pharmacy_partner_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["pharmacy_order_status"]
          total_kobo?: number
          updated_at?: string
          voucher_covered_kobo?: number
        }
        Update: {
          applied_voucher_id?: string | null
          courier_reference?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_address?: Json | null
          delivery_confirmed_at?: string | null
          estimated_delivery_at?: string | null
          fulfilment_method?: Database["public"]["Enums"]["pharmacy_fulfilment_method"]
          id?: string
          items?: Json
          logistics_partner_id?: string | null
          order_number?: string | null
          ordered_by?: string | null
          organisation_id?: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          patient_id?: string
          payable_kobo?: number | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          pharmacy_partner_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["pharmacy_order_status"]
          total_kobo?: number
          updated_at?: string
          voucher_covered_kobo?: number
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_orders_logistics_partner_id_fkey"
            columns: ["logistics_partner_id"]
            isOneToOne: false
            referencedRelation: "logistics_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_orders_ordered_by_fkey"
            columns: ["ordered_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_orders_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pharmacy_orders_pharmacy_partner_id_fkey"
            columns: ["pharmacy_partner_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_partner_locations: {
        Row: {
          address: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name: string
          pharmacy_partner_id: string
          state: string
        }
        Insert: {
          address?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          pharmacy_partner_id: string
          state: string
        }
        Update: {
          address?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          pharmacy_partner_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_partner_locations_pharmacy_partner_id_fkey"
            columns: ["pharmacy_partner_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      pharmacy_partners: {
        Row: {
          address: string | null
          area: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          delivery: boolean
          id: string
          is_active: boolean
          latitude: number | null
          license_expires_at: string | null
          license_number: string | null
          license_type: string | null
          license_verified_at: string | null
          license_verified_by: string | null
          longitude: number | null
          name: string
          regions: string[]
          state: string | null
          uses_platform_login: boolean
        }
        Insert: {
          address?: string | null
          area?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery?: boolean
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          longitude?: number | null
          name: string
          regions?: string[]
          state?: string | null
          uses_platform_login?: boolean
        }
        Update: {
          address?: string | null
          area?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          delivery?: boolean
          id?: string
          is_active?: boolean
          latitude?: number | null
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          longitude?: number | null
          name?: string
          regions?: string[]
          state?: string | null
          uses_platform_login?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_partners_license_verified_by_fkey"
            columns: ["license_verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_currency_settings: {
        Row: {
          id: boolean
          ngn_per_usd: number | null
          updated_at: string
          updated_by: string | null
          usd_processing_fee_pct: number
        }
        Insert: {
          id?: boolean
          ngn_per_usd?: number | null
          updated_at?: string
          updated_by?: string | null
          usd_processing_fee_pct?: number
        }
        Update: {
          id?: boolean
          ngn_per_usd?: number | null
          updated_at?: string
          updated_by?: string | null
          usd_processing_fee_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_currency_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_finance_inputs: {
        Row: {
          cash_balance_minor: number
          currency: Database["public"]["Enums"]["currency"]
          gross_margin_pct: number
          id: string
          marketing_spend_minor: number
          new_customers: number | null
          notes: string | null
          operating_expense_minor: number
          period_month: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cash_balance_minor?: number
          currency?: Database["public"]["Enums"]["currency"]
          gross_margin_pct?: number
          id?: string
          marketing_spend_minor?: number
          new_customers?: number | null
          notes?: string | null
          operating_expense_minor?: number
          period_month: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cash_balance_minor?: number
          currency?: Database["public"]["Enums"]["currency"]
          gross_margin_pct?: number
          id?: string
          marketing_spend_minor?: number
          new_customers?: number | null
          notes?: string | null
          operating_expense_minor?: number
          period_month?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_finance_inputs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prevention_campaign_enrolments: {
        Row: {
          campaign_id: string
          id: string
          joined_at: string
          organisation_id: string
          patient_id: string
          status: Database["public"]["Enums"]["prevention_campaign_enrolment_status"]
          updated_at: string
        }
        Insert: {
          campaign_id: string
          id?: string
          joined_at?: string
          organisation_id: string
          patient_id: string
          status?: Database["public"]["Enums"]["prevention_campaign_enrolment_status"]
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          id?: string
          joined_at?: string
          organisation_id?: string
          patient_id?: string
          status?: Database["public"]["Enums"]["prevention_campaign_enrolment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prevention_campaign_enrolments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "prevention_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prevention_campaign_enrolments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prevention_campaign_enrolments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prevention_campaigns: {
        Row: {
          actions: Json
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          eligibility_rule: Json
          ends_on: string | null
          id: string
          name: string
          organisation_id: string
          starts_on: string
          status: Database["public"]["Enums"]["prevention_campaign_status"]
          updated_at: string
        }
        Insert: {
          actions?: Json
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          eligibility_rule?: Json
          ends_on?: string | null
          id?: string
          name: string
          organisation_id: string
          starts_on: string
          status?: Database["public"]["Enums"]["prevention_campaign_status"]
          updated_at?: string
        }
        Update: {
          actions?: Json
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          eligibility_rule?: Json
          ends_on?: string | null
          id?: string
          name?: string
          organisation_id?: string
          starts_on?: string
          status?: Database["public"]["Enums"]["prevention_campaign_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prevention_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prevention_campaigns_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      prevention_risk_scores: {
        Row: {
          computed_at: string
          condition: Database["public"]["Enums"]["prevention_condition"]
          confidence: Database["public"]["Enums"]["risk_confidence"] | null
          created_at: string
          id: string
          inputs_snapshot: Json
          model_name: string | null
          model_version: string | null
          organisation_id: string
          profile_id: string
          tier: Database["public"]["Enums"]["risk_level"]
        }
        Insert: {
          computed_at?: string
          condition: Database["public"]["Enums"]["prevention_condition"]
          confidence?: Database["public"]["Enums"]["risk_confidence"] | null
          created_at?: string
          id?: string
          inputs_snapshot?: Json
          model_name?: string | null
          model_version?: string | null
          organisation_id: string
          profile_id: string
          tier?: Database["public"]["Enums"]["risk_level"]
        }
        Update: {
          computed_at?: string
          condition?: Database["public"]["Enums"]["prevention_condition"]
          confidence?: Database["public"]["Enums"]["risk_confidence"] | null
          created_at?: string
          id?: string
          inputs_snapshot?: Json
          model_name?: string | null
          model_version?: string | null
          organisation_id?: string
          profile_id?: string
          tier?: Database["public"]["Enums"]["risk_level"]
        }
        Relationships: [
          {
            foreignKeyName: "prevention_risk_scores_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prevention_risk_scores_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      preventive_programme_enrolments: {
        Row: {
          created_at: string
          enrolled_at: string
          id: string
          organisation_id: string
          patient_id: string
          programme_id: string
          source: Database["public"]["Enums"]["preventive_enrolment_source"]
          status: Database["public"]["Enums"]["preventive_enrolment_status"]
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          created_at?: string
          enrolled_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          programme_id: string
          source?: Database["public"]["Enums"]["preventive_enrolment_source"]
          status?: Database["public"]["Enums"]["preventive_enrolment_status"]
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          created_at?: string
          enrolled_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          programme_id?: string
          source?: Database["public"]["Enums"]["preventive_enrolment_source"]
          status?: Database["public"]["Enums"]["preventive_enrolment_status"]
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "preventive_programme_enrolments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_programme_enrolments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_programme_enrolments_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "preventive_programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      preventive_programmes: {
        Row: {
          code: string
          created_at: string
          description: string | null
          focus_areas: string[]
          id: string
          is_active: boolean
          name: string
          protocol_slug: string
          review_cadence_months: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          focus_areas?: string[]
          id?: string
          is_active?: boolean
          name: string
          protocol_slug: string
          review_cadence_months?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          focus_areas?: string[]
          id?: string
          is_active?: boolean
          name?: string
          protocol_slug?: string
          review_cadence_months?: number
        }
        Relationships: []
      }
      preventive_reviews: {
        Row: {
          completed_at: string | null
          created_at: string
          due_date: string
          enrolment_id: string
          id: string
          notes: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["medication_review_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_date: string
          enrolment_id: string
          id?: string
          notes?: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["medication_review_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_date?: string
          enrolment_id?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["medication_review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preventive_reviews_enrolment_id_fkey"
            columns: ["enrolment_id"]
            isOneToOne: false
            referencedRelation: "preventive_programme_enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_reviews_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_reviews_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_access: {
        Row: {
          clinical_access: boolean
          clinical_access_updated_at: string | null
          created_at: string
          granted_by: string
          grantee_user_id: string
          id: string
          permission_level: Database["public"]["Enums"]["profile_access_level"]
          profile_id: string
          updated_at: string
        }
        Insert: {
          clinical_access?: boolean
          clinical_access_updated_at?: string | null
          created_at?: string
          granted_by: string
          grantee_user_id: string
          id?: string
          permission_level?: Database["public"]["Enums"]["profile_access_level"]
          profile_id: string
          updated_at?: string
        }
        Update: {
          clinical_access?: boolean
          clinical_access_updated_at?: string | null
          created_at?: string
          granted_by?: string
          grantee_user_id?: string
          id?: string
          permission_level?: Database["public"]["Enums"]["profile_access_level"]
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_access_grantee_user_id_fkey"
            columns: ["grantee_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_access_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          app_last_active_at: string | null
          area: string | null
          avatar_url: string | null
          city: string | null
          condition_language_preference: string
          created_at: string
          custom_role_id: string | null
          date_of_birth: string | null
          emergency_contact_consent: boolean
          emergency_contact_consent_at: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          full_name: string | null
          hbv_status: Database["public"]["Enums"]["hbv_status"]
          hcv_status: Database["public"]["Enums"]["hcv_status"]
          hiv_status: Database["public"]["Enums"]["hiv_status"]
          id: string
          identity_verified_at: string | null
          is_active: boolean
          is_dependent_account: boolean
          is_partner_admin: boolean
          is_pregnant: boolean
          lab_provider_id: string | null
          language: string
          metadata: Json
          next_of_kin_name: string | null
          next_of_kin_phone: string | null
          onboarding_completed_at: string | null
          organisation_id: string | null
          patient_number: string | null
          pharmacy_partner_id: string | null
          phone: string | null
          preferred_reminder_channel: string | null
          receives_care: boolean
          role: Database["public"]["Enums"]["user_role"]
          sex: Database["public"]["Enums"]["sex"] | null
          staff_number: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          app_last_active_at?: string | null
          area?: string | null
          avatar_url?: string | null
          city?: string | null
          condition_language_preference?: string
          created_at?: string
          custom_role_id?: string | null
          date_of_birth?: string | null
          emergency_contact_consent?: boolean
          emergency_contact_consent_at?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          full_name?: string | null
          hbv_status?: Database["public"]["Enums"]["hbv_status"]
          hcv_status?: Database["public"]["Enums"]["hcv_status"]
          hiv_status?: Database["public"]["Enums"]["hiv_status"]
          id: string
          identity_verified_at?: string | null
          is_active?: boolean
          is_dependent_account?: boolean
          is_partner_admin?: boolean
          is_pregnant?: boolean
          lab_provider_id?: string | null
          language?: string
          metadata?: Json
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          onboarding_completed_at?: string | null
          organisation_id?: string | null
          patient_number?: string | null
          pharmacy_partner_id?: string | null
          phone?: string | null
          preferred_reminder_channel?: string | null
          receives_care?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
          staff_number?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          app_last_active_at?: string | null
          area?: string | null
          avatar_url?: string | null
          city?: string | null
          condition_language_preference?: string
          created_at?: string
          custom_role_id?: string | null
          date_of_birth?: string | null
          emergency_contact_consent?: boolean
          emergency_contact_consent_at?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          full_name?: string | null
          hbv_status?: Database["public"]["Enums"]["hbv_status"]
          hcv_status?: Database["public"]["Enums"]["hcv_status"]
          hiv_status?: Database["public"]["Enums"]["hiv_status"]
          id?: string
          identity_verified_at?: string | null
          is_active?: boolean
          is_dependent_account?: boolean
          is_partner_admin?: boolean
          is_pregnant?: boolean
          lab_provider_id?: string | null
          language?: string
          metadata?: Json
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          onboarding_completed_at?: string | null
          organisation_id?: string | null
          patient_number?: string | null
          pharmacy_partner_id?: string | null
          phone?: string | null
          preferred_reminder_channel?: string | null
          receives_care?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
          staff_number?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_lab_provider_id_fkey"
            columns: ["lab_provider_id"]
            isOneToOne: false
            referencedRelation: "lab_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_pharmacy_partner_id_fkey"
            columns: ["pharmacy_partner_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_api_usage_log: {
        Row: {
          api_key_id: string
          called_at: string
          endpoint: string
          id: string
          organisation_id: string
        }
        Insert: {
          api_key_id: string
          called_at?: string
          endpoint: string
          id?: string
          organisation_id: string
        }
        Update: {
          api_key_id?: string
          called_at?: string
          endpoint?: string
          id?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_api_usage_log_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_api_usage_log_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_versions: {
        Row: {
          approved_at: string
          approved_by: string
          change_summary: string
          content: Json
          created_at: string
          id: string
          organisation_id: string
          protocol_id: string
          title: string
          version_number: number
        }
        Insert: {
          approved_at?: string
          approved_by: string
          change_summary: string
          content?: Json
          created_at?: string
          id?: string
          organisation_id: string
          protocol_id: string
          title: string
          version_number: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          change_summary?: string
          content?: Json
          created_at?: string
          id?: string
          organisation_id?: string
          protocol_id?: string
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "protocol_versions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_versions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_impact_metrics: {
        Row: {
          computed_at: string | null
          description: string | null
          display_order: number
          is_published: boolean
          label: string
          metric_key: string
          suppressed: boolean
          updated_at: string
          value: number | null
        }
        Insert: {
          computed_at?: string | null
          description?: string | null
          display_order?: number
          is_published?: boolean
          label: string
          metric_key: string
          suppressed?: boolean
          updated_at?: string
          value?: number | null
        }
        Update: {
          computed_at?: string | null
          description?: string | null
          display_order?: number
          is_published?: boolean
          label?: string
          metric_key?: string
          suppressed?: boolean
          updated_at?: string
          value?: number | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string | null
          created_at: string
          disabled_at: string | null
          endpoint: string | null
          expo_push_token: string | null
          id: string
          last_seen_at: string
          organisation_id: string
          p256dh_key: string | null
          platform: string
          profile_id: string
          user_agent: string | null
        }
        Insert: {
          auth_key?: string | null
          created_at?: string
          disabled_at?: string | null
          endpoint?: string | null
          expo_push_token?: string | null
          id?: string
          last_seen_at?: string
          organisation_id: string
          p256dh_key?: string | null
          platform?: string
          profile_id: string
          user_agent?: string | null
        }
        Update: {
          auth_key?: string | null
          created_at?: string
          disabled_at?: string | null
          endpoint?: string | null
          expo_push_token?: string | null
          id?: string
          last_seen_at?: string
          organisation_id?: string
          p256dh_key?: string | null
          platform?: string
          profile_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      record_corrections: {
        Row: {
          changed_columns: string[]
          corrected_at: string
          corrected_by: string | null
          entity_id: string
          id: string
          new_values: Json | null
          old_values: Json
          organisation_id: string | null
          patient_id: string | null
          reason: string | null
          table_name: string
        }
        Insert: {
          changed_columns: string[]
          corrected_at?: string
          corrected_by?: string | null
          entity_id: string
          id?: string
          new_values?: Json | null
          old_values: Json
          organisation_id?: string | null
          patient_id?: string | null
          reason?: string | null
          table_name: string
        }
        Update: {
          changed_columns?: string[]
          corrected_at?: string
          corrected_by?: string | null
          entity_id?: string
          id?: string
          new_values?: Json | null
          old_values?: Json
          organisation_id?: string | null
          patient_id?: string | null
          reason?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_corrections_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_corrections_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_corrections_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          organisation_id: string
          profile_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          organisation_id: string
          profile_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          organisation_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_codes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          id: string
          organisation_id: string | null
          referred_id: string | null
          referred_phone: string | null
          referrer_id: string
          reward_kobo: number
          reward_status: Database["public"]["Enums"]["referral_reward_status"]
          type: Database["public"]["Enums"]["referral_type"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          organisation_id?: string | null
          referred_id?: string | null
          referred_phone?: string | null
          referrer_id: string
          reward_kobo?: number
          reward_status?: Database["public"]["Enums"]["referral_reward_status"]
          type?: Database["public"]["Enums"]["referral_type"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          organisation_id?: string | null
          referred_id?: string | null
          referred_phone?: string | null
          referrer_id?: string
          reward_kobo?: number
          reward_status?: Database["public"]["Enums"]["referral_reward_status"]
          type?: Database["public"]["Enums"]["referral_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      region_waitlist: {
        Row: {
          care_recipient_id: string | null
          created_at: string
          id: string
          notified_at: string | null
          requester_id: string
          service_type: string
          state: string
          to_email: string | null
          to_phone: string | null
        }
        Insert: {
          care_recipient_id?: string | null
          created_at?: string
          id?: string
          notified_at?: string | null
          requester_id: string
          service_type: string
          state: string
          to_email?: string | null
          to_phone?: string | null
        }
        Update: {
          care_recipient_id?: string | null
          created_at?: string
          id?: string
          notified_at?: string | null
          requester_id?: string
          service_type?: string
          state?: string
          to_email?: string | null
          to_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "region_waitlist_care_recipient_id_fkey"
            columns: ["care_recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "region_waitlist_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reproductive_health_profiles: {
        Row: {
          average_cycle_length_days: number | null
          created_at: string
          id: string
          last_period_date: string | null
          life_stage: Database["public"]["Enums"]["reproductive_life_stage"]
          organisation_id: string
          patient_id: string
          updated_at: string
        }
        Insert: {
          average_cycle_length_days?: number | null
          created_at?: string
          id?: string
          last_period_date?: string | null
          life_stage?: Database["public"]["Enums"]["reproductive_life_stage"]
          organisation_id: string
          patient_id: string
          updated_at?: string
        }
        Update: {
          average_cycle_length_days?: number | null
          created_at?: string
          id?: string
          last_period_date?: string | null
          life_stage?: Database["public"]["Enums"]["reproductive_life_stage"]
          organisation_id?: string
          patient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reproductive_health_profiles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reproductive_health_profiles_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_recognition_schedules: {
        Row: {
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          deferred_account_code: string
          id: string
          organisation_id: string | null
          payment_transaction_id: string | null
          period_end: string
          period_start: string
          recognized_minor: number
          revenue_account_code: string
          source_id: string | null
          source_kind: string
          status: string
          total_minor: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          deferred_account_code?: string
          id?: string
          organisation_id?: string | null
          payment_transaction_id?: string | null
          period_end: string
          period_start: string
          recognized_minor?: number
          revenue_account_code: string
          source_id?: string | null
          source_kind: string
          status?: string
          total_minor: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          deferred_account_code?: string
          id?: string
          organisation_id?: string | null
          payment_transaction_id?: string | null
          period_end?: string
          period_start?: string
          recognized_minor?: number
          revenue_account_code?: string
          source_id?: string | null
          source_kind?: string
          status?: string
          total_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_recognition_schedules_deferred_account_code_fkey"
            columns: ["deferred_account_code"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "revenue_recognition_schedules_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_recognition_schedules_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_recognition_schedules_revenue_account_code_fkey"
            columns: ["revenue_account_code"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["code"]
          },
        ]
      }
      risk_assessment_responses: {
        Row: {
          category: Database["public"]["Enums"]["risk_assessment_category"]
          created_at: string
          id: string
          logged_by_profile_id: string | null
          organisation_id: string
          profile_id: string
          question_key: string
          response: Json
        }
        Insert: {
          category: Database["public"]["Enums"]["risk_assessment_category"]
          created_at?: string
          id?: string
          logged_by_profile_id?: string | null
          organisation_id: string
          profile_id: string
          question_key: string
          response?: Json
        }
        Update: {
          category?: Database["public"]["Enums"]["risk_assessment_category"]
          created_at?: string
          id?: string
          logged_by_profile_id?: string | null
          organisation_id?: string
          profile_id?: string
          question_key?: string
          response?: Json
        }
        Relationships: [
          {
            foreignKeyName: "risk_assessment_responses_logged_by_profile_id_fkey"
            columns: ["logged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_assessment_responses_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_assessment_responses_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_questionnaire_configs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          code: string
          config: Json
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          organisation_id: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          code: string
          config: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organisation_id: string
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          code?: string
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organisation_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_questionnaire_configs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_questionnaire_configs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_reassessment_queue: {
        Row: {
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          processed_at: string | null
          reason: Database["public"]["Enums"]["reassessment_reason"]
          requested_at: string
          source_id: string | null
          source_table: string
        }
        Insert: {
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          processed_at?: string | null
          reason: Database["public"]["Enums"]["reassessment_reason"]
          requested_at?: string
          source_id?: string | null
          source_table: string
        }
        Update: {
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          processed_at?: string | null
          reason?: Database["public"]["Enums"]["reassessment_reason"]
          requested_at?: string
          source_id?: string | null
          source_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_reassessment_queue_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_reassessment_queue_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_register: {
        Row: {
          category: string
          created_at: string
          id: string
          impact: string
          likelihood: string
          mitigation: string | null
          owner: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          impact?: string
          likelihood?: string
          mitigation?: string | null
          owner?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          impact?: string
          likelihood?: string
          mitigation?: string | null
          owner?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          custom_role_id: string
          permission_key: string
        }
        Insert: {
          custom_role_id: string
          permission_key: string
        }
        Update: {
          custom_role_id?: string
          permission_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      screen_types: {
        Row: {
          age_from: number | null
          age_to: number | null
          category: string | null
          clinical_basis: string | null
          code: string
          commission_rate: number | null
          created_at: string
          frequency_months: number | null
          fulfilment_dormant: boolean
          id: string
          is_active: boolean
          is_optional: boolean
          name: string
          once_per_lifetime: boolean
          price_kobo: number | null
          price_source:
            | Database["public"]["Enums"]["screen_price_source"]
            | null
          recommended_provider_type:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          reopens_on_exposure: boolean
          sensitive: boolean
          sex_applicability: Database["public"]["Enums"]["screen_applicability"]
        }
        Insert: {
          age_from?: number | null
          age_to?: number | null
          category?: string | null
          clinical_basis?: string | null
          code: string
          commission_rate?: number | null
          created_at?: string
          frequency_months?: number | null
          fulfilment_dormant?: boolean
          id?: string
          is_active?: boolean
          is_optional?: boolean
          name: string
          once_per_lifetime?: boolean
          price_kobo?: number | null
          price_source?:
            | Database["public"]["Enums"]["screen_price_source"]
            | null
          recommended_provider_type?:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          reopens_on_exposure?: boolean
          sensitive?: boolean
          sex_applicability?: Database["public"]["Enums"]["screen_applicability"]
        }
        Update: {
          age_from?: number | null
          age_to?: number | null
          category?: string | null
          clinical_basis?: string | null
          code?: string
          commission_rate?: number | null
          created_at?: string
          frequency_months?: number | null
          fulfilment_dormant?: boolean
          id?: string
          is_active?: boolean
          is_optional?: boolean
          name?: string
          once_per_lifetime?: boolean
          price_kobo?: number | null
          price_source?:
            | Database["public"]["Enums"]["screen_price_source"]
            | null
          recommended_provider_type?:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          reopens_on_exposure?: boolean
          sensitive?: boolean
          sex_applicability?: Database["public"]["Enums"]["screen_applicability"]
        }
        Relationships: []
      }
      screening_completions: {
        Row: {
          created_at: string
          id: string
          note: string | null
          organisation_id: string
          patient_id: string
          performed_date: string
          schedule_id: string | null
          screen_type_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          organisation_id: string
          patient_id: string
          performed_date: string
          schedule_id?: string | null
          screen_type_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          organisation_id?: string
          patient_id?: string
          performed_date?: string
          schedule_id?: string | null
          screen_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_completions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_completions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_completions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "screening_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_completions_screen_type_id_fkey"
            columns: ["screen_type_id"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_pathway_coverage: {
        Row: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          item_code: string
        }
        Insert: {
          condition: Database["public"]["Enums"]["care_plan_condition"]
          item_code: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["care_plan_condition"]
          item_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_pathway_coverage_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["code"]
          },
        ]
      }
      screening_results: {
        Row: {
          abnormal_flags: string[]
          created_at: string
          follow_up_action: string | null
          id: string
          lab_order_id: string | null
          organisation_id: string
          patient_id: string
          result_status: Database["public"]["Enums"]["result_status"]
          result_summary: string | null
          schedule_id: string | null
          screen_type_code: string | null
        }
        Insert: {
          abnormal_flags?: string[]
          created_at?: string
          follow_up_action?: string | null
          id?: string
          lab_order_id?: string | null
          organisation_id: string
          patient_id: string
          result_status: Database["public"]["Enums"]["result_status"]
          result_summary?: string | null
          schedule_id?: string | null
          screen_type_code?: string | null
        }
        Update: {
          abnormal_flags?: string[]
          created_at?: string
          follow_up_action?: string | null
          id?: string
          lab_order_id?: string | null
          organisation_id?: string
          patient_id?: string
          result_status?: Database["public"]["Enums"]["result_status"]
          result_summary?: string | null
          schedule_id?: string | null
          screen_type_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "screening_results_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_results_lab_order_id_fkey"
            columns: ["lab_order_id"]
            isOneToOne: false
            referencedRelation: "lab_orders_awaiting_transmission"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_results_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_results_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_results_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "screening_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_results_screen_type_code_fkey"
            columns: ["screen_type_code"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["code"]
          },
        ]
      }
      screening_schedules: {
        Row: {
          created_at: string
          due_date: string
          id: string
          next_due_date: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          reminder_stage: Database["public"]["Enums"]["reminder_stage"] | null
          screen_type_id: string
          status: Database["public"]["Enums"]["screening_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_date: string
          id?: string
          next_due_date?: string | null
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          reminder_stage?: Database["public"]["Enums"]["reminder_stage"] | null
          screen_type_id: string
          status?: Database["public"]["Enums"]["screening_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_date?: string
          id?: string
          next_due_date?: string | null
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          reminder_stage?: Database["public"]["Enums"]["reminder_stage"] | null
          screen_type_id?: string
          status?: Database["public"]["Enums"]["screening_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_schedules_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_schedules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_schedules_screen_type_id_fkey"
            columns: ["screen_type_id"]
            isOneToOne: false
            referencedRelation: "screen_types"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_upgrades: {
        Row: {
          action_taken: string | null
          condition_triggered: Database["public"]["Enums"]["upgrade_condition"]
          handled_by_clinician_id: string | null
          id: string
          organisation_id: string
          patient_id: string
          screening_result_id: string
          upgrade_at: string
        }
        Insert: {
          action_taken?: string | null
          condition_triggered?: Database["public"]["Enums"]["upgrade_condition"]
          handled_by_clinician_id?: string | null
          id?: string
          organisation_id: string
          patient_id: string
          screening_result_id: string
          upgrade_at?: string
        }
        Update: {
          action_taken?: string | null
          condition_triggered?: Database["public"]["Enums"]["upgrade_condition"]
          handled_by_clinician_id?: string | null
          id?: string
          organisation_id?: string
          patient_id?: string
          screening_result_id?: string
          upgrade_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_upgrades_handled_by_clinician_id_fkey"
            columns: ["handled_by_clinician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_upgrades_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_upgrades_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_upgrades_screening_result_id_fkey"
            columns: ["screening_result_id"]
            isOneToOne: false
            referencedRelation: "screening_results"
            referencedColumns: ["id"]
          },
        ]
      }
      serology_status_transitions: {
        Row: {
          created_at: string
          from_status: string
          id: string
          organisation_id: string
          patient_id: string
          screening_result_id: string | null
          to_status: string
          virus: string
        }
        Insert: {
          created_at?: string
          from_status: string
          id?: string
          organisation_id: string
          patient_id: string
          screening_result_id?: string | null
          to_status: string
          virus: string
        }
        Update: {
          created_at?: string
          from_status?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          screening_result_id?: string | null
          to_status?: string
          virus?: string
        }
        Relationships: [
          {
            foreignKeyName: "serology_status_transitions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serology_status_transitions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serology_status_transitions_screening_result_id_fkey"
            columns: ["screening_result_id"]
            isOneToOne: false
            referencedRelation: "screening_results"
            referencedColumns: ["id"]
          },
        ]
      }
      service_regions: {
        Row: {
          activated_at: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          state: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          state: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      sick_day_logs: {
        Row: {
          appetite: Database["public"]["Enums"]["appetite_level"]
          created_at: string
          id: string
          illness: string | null
          note: string | null
          organisation_id: string
          patient_id: string
          started_on: string
          updated_at: string
          vomiting: boolean
        }
        Insert: {
          appetite?: Database["public"]["Enums"]["appetite_level"]
          created_at?: string
          id?: string
          illness?: string | null
          note?: string | null
          organisation_id: string
          patient_id: string
          started_on?: string
          updated_at?: string
          vomiting?: boolean
        }
        Update: {
          appetite?: Database["public"]["Enums"]["appetite_level"]
          created_at?: string
          id?: string
          illness?: string | null
          note?: string | null
          organisation_id?: string
          patient_id?: string
          started_on?: string
          updated_at?: string
          vomiting?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sick_day_logs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sick_day_logs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_history: {
        Row: {
          created_at: string
          healthcare_access: string | null
          id: string
          living_situation: string | null
          occupation: string | null
          occupational_exposure: string | null
          organisation_id: string
          patient_id: string
          recorded_by: string | null
          socioeconomic_barriers: string[]
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          healthcare_access?: string | null
          id?: string
          living_situation?: string | null
          occupation?: string | null
          occupational_exposure?: string | null
          organisation_id: string
          patient_id: string
          recorded_by?: string | null
          socioeconomic_barriers?: string[]
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          healthcare_access?: string | null
          id?: string
          living_situation?: string | null
          occupation?: string | null
          occupational_exposure?: string | null
          organisation_id?: string
          patient_id?: string
          recorded_by?: string | null
          socioeconomic_barriers?: string[]
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_history_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_history_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_history_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      specialist_providers: {
        Row: {
          accepted_hmos: string[]
          area: string | null
          city: string | null
          commission_flat_kobo: number | null
          commission_rate: number | null
          commission_rate_type: Database["public"]["Enums"]["commission_rate_type"]
          consultation_fee_kobo: number
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          languages: string[]
          license_expires_at: string | null
          license_number: string | null
          license_type: string | null
          license_verified_at: string | null
          license_verified_by: string | null
          location: string | null
          name: string
          specialist_type: Database["public"]["Enums"]["specialist_type"]
          state: string | null
          supports_in_person: boolean
          supports_telemedicine: boolean
        }
        Insert: {
          accepted_hmos?: string[]
          area?: string | null
          city?: string | null
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          consultation_fee_kobo?: number
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          languages?: string[]
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          location?: string | null
          name: string
          specialist_type: Database["public"]["Enums"]["specialist_type"]
          state?: string | null
          supports_in_person?: boolean
          supports_telemedicine?: boolean
        }
        Update: {
          accepted_hmos?: string[]
          area?: string | null
          city?: string | null
          commission_flat_kobo?: number | null
          commission_rate?: number | null
          commission_rate_type?: Database["public"]["Enums"]["commission_rate_type"]
          consultation_fee_kobo?: number
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          languages?: string[]
          license_expires_at?: string | null
          license_number?: string | null
          license_type?: string | null
          license_verified_at?: string | null
          license_verified_by?: string | null
          location?: string | null
          name?: string
          specialist_type?: Database["public"]["Enums"]["specialist_type"]
          state?: string | null
          supports_in_person?: boolean
          supports_telemedicine?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "specialist_providers_license_verified_by_fkey"
            columns: ["license_verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      specialist_referrals: {
        Row: {
          applied_voucher_id: string | null
          appointment_date: string | null
          booking_confirmed_at: string | null
          clinical_summary: Json | null
          created_at: string
          fulfilment: Database["public"]["Enums"]["fulfilment_mode"]
          id: string
          interim_management_plan: string | null
          organisation_id: string
          origin: Database["public"]["Enums"]["booking_origin"]
          patient_id: string
          payable_kobo: number | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          referral_fee_kobo: number
          referral_number: string | null
          referral_reason: string | null
          screening_upgrade_id: string | null
          set_by: string | null
          shared_care_handback_at: string | null
          specialist_provider_id: string | null
          specialist_type: Database["public"]["Enums"]["specialist_type"]
          status: Database["public"]["Enums"]["referral_status"]
          treatment_plan_note: string | null
          treatment_plan_received_at: string | null
          updated_at: string
          urgency: Database["public"]["Enums"]["referral_urgency"] | null
          voucher_covered_kobo: number
          waitlisted_at: string | null
        }
        Insert: {
          applied_voucher_id?: string | null
          appointment_date?: string | null
          booking_confirmed_at?: string | null
          clinical_summary?: Json | null
          created_at?: string
          fulfilment?: Database["public"]["Enums"]["fulfilment_mode"]
          id?: string
          interim_management_plan?: string | null
          organisation_id: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          patient_id: string
          payable_kobo?: number | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          referral_fee_kobo?: number
          referral_number?: string | null
          referral_reason?: string | null
          screening_upgrade_id?: string | null
          set_by?: string | null
          shared_care_handback_at?: string | null
          specialist_provider_id?: string | null
          specialist_type: Database["public"]["Enums"]["specialist_type"]
          status?: Database["public"]["Enums"]["referral_status"]
          treatment_plan_note?: string | null
          treatment_plan_received_at?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["referral_urgency"] | null
          voucher_covered_kobo?: number
          waitlisted_at?: string | null
        }
        Update: {
          applied_voucher_id?: string | null
          appointment_date?: string | null
          booking_confirmed_at?: string | null
          clinical_summary?: Json | null
          created_at?: string
          fulfilment?: Database["public"]["Enums"]["fulfilment_mode"]
          id?: string
          interim_management_plan?: string | null
          organisation_id?: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          patient_id?: string
          payable_kobo?: number | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          referral_fee_kobo?: number
          referral_number?: string | null
          referral_reason?: string | null
          screening_upgrade_id?: string | null
          set_by?: string | null
          shared_care_handback_at?: string | null
          specialist_provider_id?: string | null
          specialist_type?: Database["public"]["Enums"]["specialist_type"]
          status?: Database["public"]["Enums"]["referral_status"]
          treatment_plan_note?: string | null
          treatment_plan_received_at?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["referral_urgency"] | null
          voucher_covered_kobo?: number
          waitlisted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "specialist_referrals_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specialist_referrals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specialist_referrals_screening_upgrade_id_fkey"
            columns: ["screening_upgrade_id"]
            isOneToOne: false
            referencedRelation: "screening_upgrades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specialist_referrals_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specialist_referrals_specialist_provider_id_fkey"
            columns: ["specialist_provider_id"]
            isOneToOne: false
            referencedRelation: "specialist_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_add_ons: {
        Row: {
          add_on_id: string
          amount_minor: number
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          current_period_end: string | null
          id: string
          interval: Database["public"]["Enums"]["billing_interval"]
          organisation_id: string
          pending_provider_ref: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          provider_email_token: string | null
          provider_ref: string | null
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          subscription_id: string
          updated_at: string
        }
        Insert: {
          add_on_id: string
          amount_minor?: number
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          current_period_end?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          organisation_id: string
          pending_provider_ref?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          provider_email_token?: string | null
          provider_ref?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          subscription_id: string
          updated_at?: string
        }
        Update: {
          add_on_id?: string
          amount_minor?: number
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          current_period_end?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          organisation_id?: string
          pending_provider_ref?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          provider_email_token?: string | null
          provider_ref?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_add_ons_add_on_id_fkey"
            columns: ["add_on_id"]
            isOneToOne: false
            referencedRelation: "add_ons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_add_ons_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_add_ons_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          ai_coach_daily_limit: number | null
          code: string
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          derived_from_code: string | null
          description: string | null
          features: string[]
          id: string
          interval: Database["public"]["Enums"]["billing_interval"]
          is_active: boolean
          name: string
          paystack_plan_code: string | null
          price_locked: boolean
          price_minor: number
          stripe_price_id: string | null
          stripe_product_id: string | null
        }
        Insert: {
          ai_coach_daily_limit?: number | null
          code: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          derived_from_code?: string | null
          description?: string | null
          features?: string[]
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          is_active?: boolean
          name: string
          paystack_plan_code?: string | null
          price_locked?: boolean
          price_minor?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
        }
        Update: {
          ai_coach_daily_limit?: number | null
          code?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          derived_from_code?: string | null
          description?: string | null
          features?: string[]
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          is_active?: boolean
          name?: string
          paystack_plan_code?: string | null
          price_locked?: boolean
          price_minor?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_derived_from_code_fkey"
            columns: ["derived_from_code"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["code"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount_minor: number
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          current_period_end: string | null
          id: string
          interval: Database["public"]["Enums"]["billing_interval"]
          organisation_id: string
          paid_by_profile_id: string | null
          pending_provider_ref: string | null
          plan_id: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          provider_email_token: string | null
          provider_ref: string | null
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          subscriber_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor?: number
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          current_period_end?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          organisation_id: string
          paid_by_profile_id?: string | null
          pending_provider_ref?: string | null
          plan_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          provider_email_token?: string | null
          provider_ref?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          subscriber_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          current_period_end?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          organisation_id?: string
          paid_by_profile_id?: string | null
          pending_provider_ref?: string | null
          plan_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          provider_email_token?: string | null
          provider_ref?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          subscriber_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_paid_by_profile_id_fkey"
            columns: ["paid_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          body: string | null
          created_at: string
          direction: string
          from_phone: string
          id: string
          message_type: string
          organisation_id: string
          patient_id: string | null
          raw_payload: Json
          sender_id: string | null
          status: string
          to_phone: string | null
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          direction: string
          from_phone: string
          id?: string
          message_type?: string
          organisation_id: string
          patient_id?: string | null
          raw_payload?: Json
          sender_id?: string | null
          status?: string
          to_phone?: string | null
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          direction?: string
          from_phone?: string
          id?: string
          message_type?: string
          organisation_id?: string
          patient_id?: string | null
          raw_payload?: Json
          sender_id?: string | null
          status?: string
          to_phone?: string | null
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      symptoms: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_red_flag: boolean
          logged_by_profile_id: string | null
          organisation_id: string
          patient_id: string
          reported_at: string
          severity: number | null
          symptom_type: Database["public"]["Enums"]["symptom_type"]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_red_flag?: boolean
          logged_by_profile_id?: string | null
          organisation_id: string
          patient_id: string
          reported_at?: string
          severity?: number | null
          symptom_type: Database["public"]["Enums"]["symptom_type"]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_red_flag?: boolean
          logged_by_profile_id?: string | null
          organisation_id?: string
          patient_id?: string
          reported_at?: string
          severity?: number | null
          symptom_type?: Database["public"]["Enums"]["symptom_type"]
        }
        Relationships: [
          {
            foreignKeyName: "symptoms_logged_by_profile_id_fkey"
            columns: ["logged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "symptoms_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "symptoms_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_grants: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          permission_key: string
          profile_id: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission_key: string
          profile_id: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission_key?: string
          profile_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permission_grants_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "user_permission_grants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permission_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccination_catalog: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          recommended_age: Json
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          recommended_age?: Json
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          recommended_age?: Json
        }
        Relationships: []
      }
      vaccination_records: {
        Row: {
          booking_request_id: string | null
          certificate_url: string | null
          created_at: string
          date_administered: string
          dose_number: number
          id: string
          organisation_id: string
          physical_certificate_path: string | null
          profile_id: string
          provider: string | null
          tarragon_certificate_issued_at: string | null
          tarragon_certificate_serial: string | null
          updated_at: string
          vaccination_catalog_id: string
          verification_note: string | null
          verification_status: Database["public"]["Enums"]["vaccination_verification_status"]
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          booking_request_id?: string | null
          certificate_url?: string | null
          created_at?: string
          date_administered: string
          dose_number?: number
          id?: string
          organisation_id: string
          physical_certificate_path?: string | null
          profile_id: string
          provider?: string | null
          tarragon_certificate_issued_at?: string | null
          tarragon_certificate_serial?: string | null
          updated_at?: string
          vaccination_catalog_id: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["vaccination_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          booking_request_id?: string | null
          certificate_url?: string | null
          created_at?: string
          date_administered?: string
          dose_number?: number
          id?: string
          organisation_id?: string
          physical_certificate_path?: string | null
          profile_id?: string
          provider?: string | null
          tarragon_certificate_issued_at?: string | null
          tarragon_certificate_serial?: string | null
          updated_at?: string
          vaccination_catalog_id?: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["vaccination_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vaccination_records_booking_request_id_fkey"
            columns: ["booking_request_id"]
            isOneToOne: false
            referencedRelation: "booking_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccination_records_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccination_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccination_records_vaccination_catalog_id_fkey"
            columns: ["vaccination_catalog_id"]
            isOneToOne: false
            referencedRelation: "vaccination_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccination_records_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccination_schedule_signoffs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          catalog_snapshot: Json | null
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          source_url: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          catalog_snapshot?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          source_url?: string | null
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          catalog_snapshot?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          source_url?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "vaccination_schedule_signoffs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccination_schedules: {
        Row: {
          created_at: string
          due_date: string
          id: string
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          reminder_stage: Database["public"]["Enums"]["reminder_stage"] | null
          status: Database["public"]["Enums"]["screening_status"]
          updated_at: string
          vaccination_catalog_id: string
        }
        Insert: {
          created_at?: string
          due_date: string
          id?: string
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          reminder_stage?: Database["public"]["Enums"]["reminder_stage"] | null
          status?: Database["public"]["Enums"]["screening_status"]
          updated_at?: string
          vaccination_catalog_id: string
        }
        Update: {
          created_at?: string
          due_date?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          reminder_stage?: Database["public"]["Enums"]["reminder_stage"] | null
          status?: Database["public"]["Enums"]["screening_status"]
          updated_at?: string
          vaccination_catalog_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaccination_schedules_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccination_schedules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccination_schedules_vaccination_catalog_id_fkey"
            columns: ["vaccination_catalog_id"]
            isOneToOne: false
            referencedRelation: "vaccination_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      video_consultations: {
        Row: {
          annual_review_id: string | null
          context: Database["public"]["Enums"]["video_consultation_context"]
          created_at: string
          ended_at: string | null
          escalation_id: string | null
          host_start_url: string | null
          id: string
          initiated_by: string | null
          join_url: string | null
          organisation_id: string
          patient_confirmed_at: string | null
          patient_id: string
          proposed_slots: string[] | null
          scheduled_at: string | null
          specialist_referral_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["video_consultation_status"]
          updated_at: string
          zoom_meeting_id: string | null
        }
        Insert: {
          annual_review_id?: string | null
          context: Database["public"]["Enums"]["video_consultation_context"]
          created_at?: string
          ended_at?: string | null
          escalation_id?: string | null
          host_start_url?: string | null
          id?: string
          initiated_by?: string | null
          join_url?: string | null
          organisation_id: string
          patient_confirmed_at?: string | null
          patient_id: string
          proposed_slots?: string[] | null
          scheduled_at?: string | null
          specialist_referral_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["video_consultation_status"]
          updated_at?: string
          zoom_meeting_id?: string | null
        }
        Update: {
          annual_review_id?: string | null
          context?: Database["public"]["Enums"]["video_consultation_context"]
          created_at?: string
          ended_at?: string | null
          escalation_id?: string | null
          host_start_url?: string | null
          id?: string
          initiated_by?: string | null
          join_url?: string | null
          organisation_id?: string
          patient_confirmed_at?: string | null
          patient_id?: string
          proposed_slots?: string[] | null
          scheduled_at?: string | null
          specialist_referral_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["video_consultation_status"]
          updated_at?: string
          zoom_meeting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_consultations_annual_review_id_fkey"
            columns: ["annual_review_id"]
            isOneToOne: false
            referencedRelation: "annual_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_consultations_escalation_id_fkey"
            columns: ["escalation_id"]
            isOneToOne: false
            referencedRelation: "escalations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_consultations_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_consultations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_consultations_specialist_referral_id_fkey"
            columns: ["specialist_referral_id"]
            isOneToOne: false
            referencedRelation: "specialist_referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      video_visit_prices: {
        Row: {
          amount_minor: number
          currency: string
          id: string
          is_enabled: boolean
          organisation_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_minor: number
          currency?: string
          id?: string
          is_enabled?: boolean
          organisation_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_minor?: number
          currency?: string
          id?: string
          is_enabled?: boolean
          organisation_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_visit_prices_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_visit_prices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_visit_requests: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          amount_minor: number
          created_at: string
          currency: string
          declined_reason: string | null
          id: string
          note: string | null
          organisation_id: string
          origin: string
          patient_id: string
          payment_provider: string | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          proposed_at: string | null
          proposed_by: string | null
          proposed_slot_ids: string[] | null
          refund_ref: string | null
          refund_status: string | null
          slot_id: string | null
          status: Database["public"]["Enums"]["video_visit_request_status"]
          updated_at: string
          video_consultation_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          amount_minor?: number
          created_at?: string
          currency?: string
          declined_reason?: string | null
          id?: string
          note?: string | null
          organisation_id: string
          origin?: string
          patient_id: string
          payment_provider?: string | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          proposed_at?: string | null
          proposed_by?: string | null
          proposed_slot_ids?: string[] | null
          refund_ref?: string | null
          refund_status?: string | null
          slot_id?: string | null
          status?: Database["public"]["Enums"]["video_visit_request_status"]
          updated_at?: string
          video_consultation_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          amount_minor?: number
          created_at?: string
          currency?: string
          declined_reason?: string | null
          id?: string
          note?: string | null
          organisation_id?: string
          origin?: string
          patient_id?: string
          payment_provider?: string | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          proposed_at?: string | null
          proposed_by?: string | null
          proposed_slot_ids?: string[] | null
          refund_ref?: string | null
          refund_status?: string | null
          slot_id?: string | null
          status?: Database["public"]["Enums"]["video_visit_request_status"]
          updated_at?: string
          video_consultation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_visit_requests_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_visit_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_visit_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_visit_requests_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "clinical_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_visit_requests_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "consult_availability_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_visit_requests_video_consultation_id_fkey"
            columns: ["video_consultation_id"]
            isOneToOne: false
            referencedRelation: "video_consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      vitals_readings: {
        Row: {
          cgm_connection_id: string | null
          created_at: string
          device_id: string | null
          diastolic: number | null
          external_reading_id: string | null
          glucose_context: Database["public"]["Enums"]["glucose_context"] | null
          glucose_mmol_l: number | null
          id: string
          ketone_urine: string | null
          ketones_mmol_l: number | null
          logged_by_profile_id: string | null
          note: string | null
          organisation_id: string
          patient_id: string
          peak_flow_l_min: number | null
          pulse_bpm: number | null
          respiratory_rate_bpm: number | null
          source: Database["public"]["Enums"]["vital_source"]
          spo2_pct: number | null
          systolic: number | null
          taken_at: string
          temperature_c: number | null
          vital_type: Database["public"]["Enums"]["vital_type"]
          waist_cm: number | null
          wearable_connection_id: string | null
          weight_kg: number | null
        }
        Insert: {
          cgm_connection_id?: string | null
          created_at?: string
          device_id?: string | null
          diastolic?: number | null
          external_reading_id?: string | null
          glucose_context?:
            | Database["public"]["Enums"]["glucose_context"]
            | null
          glucose_mmol_l?: number | null
          id?: string
          ketone_urine?: string | null
          ketones_mmol_l?: number | null
          logged_by_profile_id?: string | null
          note?: string | null
          organisation_id: string
          patient_id: string
          peak_flow_l_min?: number | null
          pulse_bpm?: number | null
          respiratory_rate_bpm?: number | null
          source?: Database["public"]["Enums"]["vital_source"]
          spo2_pct?: number | null
          systolic?: number | null
          taken_at?: string
          temperature_c?: number | null
          vital_type: Database["public"]["Enums"]["vital_type"]
          waist_cm?: number | null
          wearable_connection_id?: string | null
          weight_kg?: number | null
        }
        Update: {
          cgm_connection_id?: string | null
          created_at?: string
          device_id?: string | null
          diastolic?: number | null
          external_reading_id?: string | null
          glucose_context?:
            | Database["public"]["Enums"]["glucose_context"]
            | null
          glucose_mmol_l?: number | null
          id?: string
          ketone_urine?: string | null
          ketones_mmol_l?: number | null
          logged_by_profile_id?: string | null
          note?: string | null
          organisation_id?: string
          patient_id?: string
          peak_flow_l_min?: number | null
          pulse_bpm?: number | null
          respiratory_rate_bpm?: number | null
          source?: Database["public"]["Enums"]["vital_source"]
          spo2_pct?: number | null
          systolic?: number | null
          taken_at?: string
          temperature_c?: number | null
          vital_type?: Database["public"]["Enums"]["vital_type"]
          waist_cm?: number | null
          wearable_connection_id?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vitals_readings_cgm_connection_id_fkey"
            columns: ["cgm_connection_id"]
            isOneToOne: false
            referencedRelation: "cgm_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "patient_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_readings_logged_by_profile_id_fkey"
            columns: ["logged_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_readings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_readings_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_readings_wearable_connection_id_fkey"
            columns: ["wearable_connection_id"]
            isOneToOne: false
            referencedRelation: "wearable_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      vitals_reminder_rules: {
        Row: {
          condition: Database["public"]["Enums"]["care_plan_condition"] | null
          created_at: string
          frequency_days: number
          id: string
          organisation_id: string
          patient_id: string | null
          updated_at: string
        }
        Insert: {
          condition?: Database["public"]["Enums"]["care_plan_condition"] | null
          created_at?: string
          frequency_days: number
          id?: string
          organisation_id: string
          patient_id?: string | null
          updated_at?: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["care_plan_condition"] | null
          created_at?: string
          frequency_days?: number
          id?: string
          organisation_id?: string
          patient_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vitals_reminder_rules_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_reminder_rules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vitals_reminder_state: {
        Row: {
          next_due_at: string
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
          updated_at: string
        }
        Insert: {
          next_due_at: string
          organisation_id: string
          patient_id: string
          reminder_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          next_due_at?: string
          organisation_id?: string
          patient_id?: string
          reminder_sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vitals_reminder_state_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vitals_reminder_state_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wearable_connections: {
        Row: {
          access_token: string | null
          connected_at: string
          created_at: string
          external_id: string | null
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          organisation_id: string
          patient_id: string
          provider: Database["public"]["Enums"]["wearable_provider"]
          refresh_token: string | null
          status: Database["public"]["Enums"]["wearable_connection_status"]
          sync_cursor: string | null
          token_expires_at: string | null
        }
        Insert: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          external_id?: string | null
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          organisation_id: string
          patient_id: string
          provider: Database["public"]["Enums"]["wearable_provider"]
          refresh_token?: string | null
          status?: Database["public"]["Enums"]["wearable_connection_status"]
          sync_cursor?: string | null
          token_expires_at?: string | null
        }
        Update: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          external_id?: string | null
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          organisation_id?: string
          patient_id?: string
          provider?: Database["public"]["Enums"]["wearable_provider"]
          refresh_token?: string | null
          status?: Database["public"]["Enums"]["wearable_connection_status"]
          sync_cursor?: string | null
          token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wearable_connections_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wearable_connections_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wearable_readings: {
        Row: {
          connection_id: string
          created_at: string
          external_reading_id: string | null
          id: string
          organisation_id: string
          reading_type: string
          recorded_at: string
          unit: string | null
          value: number | null
        }
        Insert: {
          connection_id: string
          created_at?: string
          external_reading_id?: string | null
          id?: string
          organisation_id: string
          reading_type: string
          recorded_at: string
          unit?: string | null
          value?: number | null
        }
        Update: {
          connection_id?: string
          created_at?: string
          external_reading_id?: string | null
          id?: string
          organisation_id?: string
          reading_type?: string
          recorded_at?: string
          unit?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wearable_readings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "wearable_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wearable_readings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      web_events: {
        Row: {
          city: string | null
          country: string | null
          device_type: string | null
          id: string
          occurred_at: string
          path: string
          profile_id: string | null
          referrer_host: string | null
          region: string | null
          session_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          device_type?: string | null
          id?: string
          occurred_at?: string
          path: string
          profile_id?: string | null
          referrer_host?: string | null
          region?: string | null
          session_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          device_type?: string | null
          id?: string
          occurred_at?: string
          path?: string
          profile_id?: string | null
          referrer_host?: string | null
          region?: string | null
          session_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "web_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_badges: {
        Row: {
          code: string
          created_at: string
          criteria_reason: string | null
          criteria_threshold: number
          criteria_type: string
          description: string | null
          icon: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          criteria_reason?: string | null
          criteria_threshold: number
          criteria_type: string
          description?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          criteria_reason?: string | null
          criteria_threshold?: number
          criteria_type?: string
          description?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      wellness_challenges: {
        Row: {
          badge_id: string | null
          code: string
          created_at: string
          description: string | null
          duration_days: number
          id: string
          is_active: boolean
          metric: Database["public"]["Enums"]["wellness_challenge_metric"]
          points_reward: number
          target_count: number
          title: string
          updated_at: string
        }
        Insert: {
          badge_id?: string | null
          code: string
          created_at?: string
          description?: string | null
          duration_days: number
          id?: string
          is_active?: boolean
          metric: Database["public"]["Enums"]["wellness_challenge_metric"]
          points_reward?: number
          target_count: number
          title: string
          updated_at?: string
        }
        Update: {
          badge_id?: string | null
          code?: string
          created_at?: string
          description?: string | null
          duration_days?: number
          id?: string
          is_active?: boolean
          metric?: Database["public"]["Enums"]["wellness_challenge_metric"]
          points_reward?: number
          target_count?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wellness_challenges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "wellness_badges"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_class_providers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          regions: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          regions?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          regions?: string[]
        }
        Relationships: []
      }
      wellness_class_registrations: {
        Row: {
          class_id: string
          id: string
          organisation_id: string
          patient_id: string
          registered_at: string
          status: Database["public"]["Enums"]["wellness_class_registration_status"]
          updated_at: string
        }
        Insert: {
          class_id: string
          id?: string
          organisation_id: string
          patient_id: string
          registered_at?: string
          status?: Database["public"]["Enums"]["wellness_class_registration_status"]
          updated_at?: string
        }
        Update: {
          class_id?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          registered_at?: string
          status?: Database["public"]["Enums"]["wellness_class_registration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wellness_class_registrations_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "wellness_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_class_registrations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_class_registrations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_classes: {
        Row: {
          capacity: number | null
          class_type: Database["public"]["Enums"]["wellness_class_type"]
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          location_or_link: string | null
          points_reward: number
          provider_id: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          class_type?: Database["public"]["Enums"]["wellness_class_type"]
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          location_or_link?: string | null
          points_reward?: number
          provider_id: string
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          class_type?: Database["public"]["Enums"]["wellness_class_type"]
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          location_or_link?: string | null
          points_reward?: number
          provider_id?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wellness_classes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "wellness_class_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_points_balances: {
        Row: {
          balance: number
          lifetime_earned: number
          organisation_id: string
          patient_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          lifetime_earned?: number
          organisation_id: string
          patient_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          lifetime_earned?: number
          organisation_id?: string
          patient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wellness_points_balances_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_points_balances_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_points_config: {
        Row: {
          id: boolean
          points_to_kobo_rate: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          points_to_kobo_rate?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          points_to_kobo_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      wellness_points_ledger: {
        Row: {
          balance_after: number
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          points: number
          reason: string
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          balance_after: number
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          points: number
          reason: string
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          balance_after?: number
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          points?: number
          reason?: string
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wellness_points_ledger_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_points_ledger_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_points_redemptions: {
        Row: {
          created_at: string
          id: string
          kobo_credited: number
          organisation_id: string
          patient_id: string
          points_redeemed: number
          voucher_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kobo_credited: number
          organisation_id: string
          patient_id: string
          points_redeemed: number
          voucher_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kobo_credited?: number
          organisation_id?: string
          patient_id?: string
          points_redeemed?: number
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wellness_points_redemptions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_points_redemptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_points_redemptions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "care_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      zoom_webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_type: string
          id: string
          processed_at: string | null
          provider_event_id: string
          raw_payload: Json
          video_consultation_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_type: string
          id?: string
          processed_at?: string | null
          provider_event_id: string
          raw_payload?: Json
          video_consultation_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          event_type?: string
          id?: string
          processed_at?: string | null
          provider_event_id?: string
          raw_payload?: Json
          video_consultation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zoom_webhook_events_video_consultation_id_fkey"
            columns: ["video_consultation_id"]
            isOneToOne: false
            referencedRelation: "video_consultations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      diabetes_quality_metrics: {
        Row: {
          avg_glucose_flag_to_contact_hours: number | null
          complete_complication_screen: number | null
          diabetic_patients: number | null
          foot_uptodate: number | null
          hba1c_at_target: number | null
          organisation_id: string | null
          renal_uptodate: number | null
          retinal_uptodate: number | null
          severe_hypo_dka_events_90d: number | null
          severe_hypo_dka_per_100_patients: number | null
          target_set: number | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plans_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_orders_awaiting_transmission: {
        Row: {
          hours_since_payment: number | null
          id: string | null
          laboratory: string | null
          order_number: string | null
          organisation_id: string | null
          partner_cost_kobo: number | null
          patient_id: string | null
          payment_confirmed_at: string | null
          total_kobo: number | null
          transmission:
            | Database["public"]["Enums"]["lab_order_transmission"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_orders_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lpe_programme_outcomes: {
        Row: {
          active: number | null
          completed: number | null
          condition: Database["public"]["Enums"]["care_plan_condition"] | null
          disengaged: number | null
          enrolled: number | null
          maintenance: number | null
          organisation_id: string | null
          paused: number | null
          reviews_overdue: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lpe_enrollments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_care_gaps: {
        Row: {
          condition_or_type: string | null
          detail: Json | null
          gap_type: string | null
          opened_at: string | null
          organisation_id: string | null
          patient_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_video_visit_request: {
        Args: { p_request_id: string }
        Returns: string
      }
      acknowledge_lab_order: {
        Args: { p_order_id: string; p_partner_reference: string }
        Returns: Json
      }
      admin_broadcast_audience_count: {
        Args: {
          p_audience: Database["public"]["Enums"]["broadcast_audience"]
          p_filter: Json
        }
        Returns: number
      }
      admin_broadcast_content_check: {
        Args: { p_text: string }
        Returns: string[]
      }
      admin_create_institution_org: {
        Args: { p_name: string; p_type: string }
        Returns: string
      }
      admin_create_protocol_partner_org: {
        Args: { p_name: string }
        Returns: string
      }
      admin_issue_protocol_api_key: {
        Args: {
          p_key_hash: string
          p_key_prefix: string
          p_name: string
          p_organisation_id: string
        }
        Returns: string
      }
      admin_link_lab_partner: {
        Args: { p_lab_provider_id: string; p_profile_id: string }
        Returns: undefined
      }
      admin_link_pharmacist: {
        Args: { p_pharmacy_partner_id: string; p_profile_id: string }
        Returns: undefined
      }
      admin_list_protocol_api_keys: {
        Args: { p_organisation_id: string }
        Returns: {
          created_at: string
          id: string
          key_prefix: string
          last_used_at: string
          name: string
          revoked_at: string
        }[]
      }
      admin_list_protocol_partners: {
        Args: never
        Returns: {
          active_key_count: number
          calls_last_30_days: number
          created_at: string
          last_called_at: string
          name: string
          organisation_id: string
        }[]
      }
      admin_member_activity: { Args: { p_member: string }; Returns: Json }
      admin_refresh_public_impact_metrics: { Args: never; Returns: undefined }
      admin_revoke_protocol_api_key: {
        Args: { p_key_id: string }
        Returns: undefined
      }
      admin_send_broadcast: {
        Args: { p_broadcast_id: string }
        Returns: number
      }
      admin_set_impact_metric_published: {
        Args: { p_is_published: boolean; p_metric_key: string }
        Returns: undefined
      }
      admin_set_partner_admin: {
        Args: { p_is_partner_admin: boolean; p_profile_id: string }
        Returns: undefined
      }
      analytics_accounting_summary: { Args: never; Returns: Json }
      analytics_acquisition_funnel: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      analytics_active_users_timeseries: {
        Args: { p_period?: string }
        Returns: Json
      }
      analytics_audit_log: {
        Args: {
          p_action?: string
          p_entity_type?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_org?: string
          p_to?: string
        }
        Returns: Json
      }
      analytics_audit_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      analytics_business_summary: { Args: never; Returns: Json }
      analytics_clinical_outcomes: { Args: never; Returns: Json }
      analytics_deliverability: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      analytics_doctor_performance: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      analytics_engagement_summary: { Args: never; Returns: Json }
      analytics_escalation_quality: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      analytics_facility_engagement: { Args: never; Returns: Json }
      analytics_feature_adoption: { Args: never; Returns: Json }
      analytics_finance_inputs: { Args: never; Returns: Json }
      analytics_financial_summary: { Args: never; Returns: Json }
      analytics_governance_summary: { Args: never; Returns: Json }
      analytics_growth_timeseries: {
        Args: { p_period?: string }
        Returns: Json
      }
      analytics_investor_summary: { Args: never; Returns: Json }
      analytics_log_patient_access: {
        Args: { p_patient_id: string; p_reason: string }
        Returns: undefined
      }
      analytics_operations_summary: { Args: never; Returns: Json }
      analytics_patient_activity: {
        Args: { p_patient_id: string }
        Returns: Json
      }
      analytics_patient_search: { Args: { p_query: string }; Returns: Json }
      analytics_population_summary: { Args: never; Returns: Json }
      analytics_provider_capacity: { Args: never; Returns: Json }
      analytics_retention_cohorts: { Args: never; Returns: Json }
      analytics_revenue_by_plan: { Args: never; Returns: Json }
      analytics_revenue_timeseries: {
        Args: { p_period?: string }
        Returns: Json
      }
      analytics_risk_register: { Args: never; Returns: Json }
      analytics_staff_activity: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      analytics_traffic_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      analytics_traffic_timeseries: {
        Args: { p_from?: string; p_period?: string; p_to?: string }
        Returns: Json
      }
      analytics_upsert_finance_input: {
        Args: {
          p_cash: number
          p_currency: string
          p_margin: number
          p_marketing: number
          p_month: string
          p_new_customers: number
          p_notes: string
          p_opex: number
        }
        Returns: undefined
      }
      analytics_upsert_risk: {
        Args: {
          p_category: string
          p_id: string
          p_impact: string
          p_likelihood: string
          p_mitigation: string
          p_owner: string
          p_status: string
          p_title: string
        }
        Returns: string
      }
      analytics_user_segments: { Args: never; Returns: Json }
      approve_lab_order_refund: { Args: { p_refund_id: string }; Returns: Json }
      approve_partner_statement: {
        Args: { p_force_note?: string; p_statement_id: string }
        Returns: Json
      }
      attest_health_passport_request: {
        Args: { p_request_id: string; p_statement?: string }
        Returns: string
      }
      bp_secondary_flags: { Args: { p_patient: string }; Returns: Json }
      can_act_for: { Args: { p_beneficiary: string }; Returns: boolean }
      cancel_care_voucher: {
        Args: { p_reason: string; p_voucher: string }
        Returns: Json
      }
      care_receipt: {
        Args: { p_beneficiary: string; p_from?: string; p_to?: string }
        Returns: Json
      }
      claim_employer_roster_member: {
        Args: { target_roster_id: string }
        Returns: boolean
      }
      claim_health_reset_trial: { Args: never; Returns: Json }
      close_masked_call: {
        Args: { p_reason?: string; p_session_id: string }
        Returns: undefined
      }
      confirm_ecg_report_extraction: {
        Args: {
          p_extraction_id: string
          p_readings: Json
          p_report_date: string
        }
        Returns: number
      }
      confirm_lab_report_extraction: {
        Args: {
          p_extraction_id: string
          p_readings: Json
          p_report_date: string
        }
        Returns: number
      }
      create_emergency_card: { Args: never; Returns: string }
      create_personalised_lifestyle_goal: {
        Args: {
          p_enrollment_id: string
          p_module: Database["public"]["Enums"]["lpe_module"]
          p_target_date?: string
          p_target_unit?: string
          p_target_value?: number
          p_title: string
        }
        Returns: {
          created_at: string
          goal_template_id: string | null
          id: string
          metric_key: string | null
          module: Database["public"]["Enums"]["lpe_module"]
          organisation_id: string
          personalised: boolean
          programme_instance_id: string
          status: Database["public"]["Enums"]["lpe_goal_status"]
          target: Json | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lpe_goal_instances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_health_passport_attestation: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      decline_video_visit_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      emergency_card_by_token: { Args: { p_token: string }; Returns: Json }
      enqueue_critical_notification: {
        Args: {
          p_alert_tier: Database["public"]["Enums"]["alert_level"]
          p_organisation_id: string
          p_pathway: string
          p_payload: Json
          p_recipient_id: string
          p_source_id?: string
          p_source_table?: string
          p_template: string
        }
        Returns: string
      }
      enrol_in_wellness_challenge: {
        Args: { p_challenge_id: string }
        Returns: string
      }
      extend_care_voucher: {
        Args: { p_reason?: string; p_voucher: string }
        Returns: Json
      }
      finance_accounts_list: { Args: never; Returns: Json }
      finance_ap_aging: { Args: never; Returns: Json }
      finance_approval_history: { Args: { p_limit?: number }; Returns: Json }
      finance_approval_settings_list: { Args: never; Returns: Json }
      finance_approve_bill: { Args: { p_id: string }; Returns: string }
      finance_approve_request: {
        Args: { p_id: string; p_note?: string }
        Returns: Json
      }
      finance_audit_actions_list: { Args: never; Returns: Json }
      finance_audit_log: {
        Args: {
          p_action?: string
          p_from?: string
          p_limit?: number
          p_to?: string
        }
        Returns: Json
      }
      finance_balance_sheet: {
        Args: { p_as_of?: string; p_currency?: string }
        Returns: Json
      }
      finance_bills_list: { Args: { p_status?: string }; Returns: Json }
      finance_budget_variance: {
        Args: { p_currency?: string; p_from: string; p_to: string }
        Returns: Json
      }
      finance_budgets_list: { Args: { p_period_month?: string }; Returns: Json }
      finance_cash_flow_statement: {
        Args: { p_currency?: string; p_from: string; p_to: string }
        Returns: Json
      }
      finance_company_profile_get: { Args: never; Returns: Json }
      finance_company_profile_upsert: {
        Args: {
          p_auditor_name?: string
          p_bank_account_name?: string
          p_bank_account_number?: string
          p_bank_name?: string
          p_company_secretary_name?: string
          p_directors_text?: string
          p_financial_year_end?: string
          p_incorporation_date?: string
          p_itf_number?: string
          p_legal_name?: string
          p_nsitf_number?: string
          p_pension_pfa_code?: string
          p_principal_business_activity?: string
          p_rc_number?: string
          p_registered_address?: string
          p_registered_email?: string
          p_registered_phone?: string
          p_tin?: string
          p_trading_name?: string
          p_vat_registration_number?: string
        }
        Returns: undefined
      }
      finance_compliance_calendar: {
        Args: { p_months_ahead?: number }
        Returns: Json
      }
      finance_compliance_calendar_for_year: {
        Args: { p_year: number }
        Returns: Json
      }
      finance_compliance_suggested_amount: {
        Args: { p_obligation_code: string; p_period_label: string }
        Returns: Json
      }
      finance_cost_centers_list: { Args: never; Returns: Json }
      finance_create_bill: {
        Args: {
          p_amount_minor: number
          p_bill_date: string
          p_cost_center_code: string
          p_currency: string
          p_description: string
          p_due_date: string
          p_expense_account_code: string
          p_vendor_id: string
        }
        Returns: string
      }
      finance_dashboard_summary: { Args: never; Returns: Json }
      finance_delete_budget: { Args: { p_id: string }; Returns: undefined }
      finance_import_settlement: {
        Args: {
          p_bank_account: string
          p_currency: string
          p_external_ref: string
          p_fees: number
          p_gross: number
          p_net: number
          p_notes: string
          p_provider: string
          p_settlement_date: string
        }
        Returns: string
      }
      finance_income_statement: {
        Args: { p_currency?: string; p_from: string; p_to: string }
        Returns: Json
      }
      finance_kpi_summary: { Args: { p_currency?: string }; Returns: Json }
      finance_ledger_entries: {
        Args: {
          p_account?: string
          p_from?: string
          p_limit?: number
          p_source?: string
          p_to?: string
        }
        Returns: Json
      }
      finance_mark_filed: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_due_date: string
          p_notes: string
          p_obligation_code: string
          p_period_label: string
          p_remittance_reference: string
        }
        Returns: string
      }
      finance_match_payment: {
        Args: {
          p_amount: number
          p_payment_transaction_id: string
          p_settlement_id: string
        }
        Returns: string
      }
      finance_pay_bill: {
        Args: { p_bank_account_code: string; p_id: string; p_paid_date: string }
        Returns: string
      }
      finance_pending_approvals: { Args: never; Returns: Json }
      finance_periods_list: { Args: never; Returns: Json }
      finance_pnl_by_cost_center: {
        Args: { p_currency?: string; p_from: string; p_to: string }
        Returns: Json
      }
      finance_post_manual_journal: {
        Args: {
          p_currency: string
          p_entry_date: string
          p_lines: Json
          p_memo: string
        }
        Returns: Json
      }
      finance_post_settlement: {
        Args: { p_settlement_id: string }
        Returns: string
      }
      finance_reconciliation_flags: {
        Args: { p_status?: string }
        Returns: Json
      }
      finance_reconciliation_summary: { Args: never; Returns: Json }
      finance_reject_request: {
        Args: { p_id: string; p_note: string }
        Returns: undefined
      }
      finance_resolve_reconciliation_flag: {
        Args: { p_id: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      finance_reverse_journal: {
        Args: { p_entry: string; p_reason: string }
        Returns: string
      }
      finance_revrec_summary: { Args: never; Returns: Json }
      finance_risk_flags: { Args: never; Returns: Json }
      finance_run_revenue_recognition: { Args: never; Returns: number }
      finance_set_period_status: {
        Args: { p_month: string; p_status: string }
        Returns: Json
      }
      finance_tax_rates_list: { Args: never; Returns: Json }
      finance_tax_summary: {
        Args: { p_currency?: string; p_from: string; p_to: string }
        Returns: Json
      }
      finance_trial_balance: {
        Args: { p_as_of?: string; p_currency?: string }
        Returns: Json
      }
      finance_unmark_filed: {
        Args: { p_obligation_code: string; p_period_label: string }
        Returns: undefined
      }
      finance_unmatch_payment: {
        Args: { p_payment_transaction_id: string }
        Returns: undefined
      }
      finance_upsert_account: {
        Args: {
          p_code: string
          p_description: string
          p_is_active: boolean
          p_name: string
          p_normal_balance: string
          p_sort_order: number
          p_type: string
          p_vat_treatment: string
        }
        Returns: string
      }
      finance_upsert_approval_threshold: {
        Args: { p_currency: string; p_threshold_minor: number }
        Returns: undefined
      }
      finance_upsert_budget: {
        Args: {
          p_account_code: string
          p_amount_minor: number
          p_cost_center_code: string
          p_currency: string
          p_notes: string
          p_period_month: string
        }
        Returns: string
      }
      finance_upsert_cost_center: {
        Args: {
          p_code: string
          p_is_active: boolean
          p_name: string
          p_sort_order: number
        }
        Returns: string
      }
      finance_upsert_tax_rate: {
        Args: {
          p_applies_to: string
          p_effective_from: string
          p_id: string
          p_is_active: boolean
          p_jurisdiction: string
          p_name: string
          p_notes: string
          p_rate_pct: number
          p_tax_type: string
        }
        Returns: string
      }
      finance_upsert_vendor: {
        Args: {
          p_contact_email: string
          p_contact_phone: string
          p_id: string
          p_is_active: boolean
          p_name: string
          p_tin: string
          p_vendor_type: string
          p_wht_applicable: boolean
          p_wht_rate_pct: number
        }
        Returns: string
      }
      finance_vendors_list: { Args: never; Returns: Json }
      finance_void_bill: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      find_profile_by_phone: {
        Args: { lookup_phone: string }
        Returns: {
          full_name: string
          id: string
        }[]
      }
      get_ai_coach_daily_limit: { Args: never; Returns: number }
      get_geo_health_aggregates: {
        Args: never
        Returns: {
          state: string
          patient_count: number | null
          hypertension_high_count: number | null
          diabetes_high_count: number | null
          cvd_high_count: number | null
          overdue_screening_count: number | null
          suppressed: boolean
        }[]
      }
      get_or_create_my_referral_code: { Args: never; Returns: string }
      has_ai_coach_access: { Args: never; Returns: boolean }
      has_feature_access: { Args: { feature: string }; Returns: boolean }
      hbpm_summary: { Args: { p_patient: string }; Returns: Json }
      health_education_category_counts: {
        Args: never
        Returns: {
          category: Database["public"]["Enums"]["health_education_category"]
          item_count: number
        }[]
      }
      health_education_feed: {
        Args: never
        Returns: {
          body: string
          check_score: number
          check_total: number
          clinician_reviewed: boolean
          code: string
          condition: Database["public"]["Enums"]["care_plan_condition"]
          content_id: string
          content_type: Database["public"]["Enums"]["health_education_content_type"]
          estimated_minutes: number
          has_knowledge_check: boolean
          knowledge_check: Json
          reviewed_by_name: string
          status: Database["public"]["Enums"]["health_education_status"]
          summary: string
          title: string
          video_url: string
        }[]
      }
      health_education_library: {
        Args: {
          p_category?: Database["public"]["Enums"]["health_education_category"]
        }
        Returns: {
          body: string
          category: Database["public"]["Enums"]["health_education_category"]
          check_score: number
          check_total: number
          clinician_reviewed: boolean
          code: string
          condition: Database["public"]["Enums"]["care_plan_condition"]
          content_id: string
          content_type: Database["public"]["Enums"]["health_education_content_type"]
          estimated_minutes: number
          has_knowledge_check: boolean
          knowledge_check: Json
          reviewed_by_name: string
          status: Database["public"]["Enums"]["health_education_status"]
          summary: string
          title: string
          video_url: string
        }[]
      }
      health_education_locked_count: { Args: never; Returns: number }
      health_passport_by_serial: {
        Args: { p_dob?: string; p_serial: string }
        Returns: Json
      }
      htn_quality_metrics: { Args: { p_org: string }; Returns: Json }
      insert_audited_lab_result_document: {
        Args: {
          p_actor_id: string
          p_file_path: string
          p_file_size_bytes: number
          p_lab_order_id: string
          p_mime_type: string
          p_note: string
          p_organisation_id: string
          p_original_filename: string
          p_patient_id: string
          p_source: Database["public"]["Enums"]["lab_result_document_source"]
          p_uploaded_by: string
        }
        Returns: string
      }
      lab_partner_order_patient: {
        Args: { p_order_id: string }
        Returns: string
      }
      lab_partner_orders: {
        Args: never
        Returns: {
          order_id: string
          order_number: string
          ordered_at: string
          panel_name: string
          patient_name: string
          patient_number: string
          resulted_at: string
          status: string
        }[]
      }
      lab_partner_own_provider_id: { Args: never; Returns: string }
      lab_partner_turnaround_stats: {
        Args: { p_days?: number }
        Returns: {
          avg_turnaround_hours: number
          median_turnaround_hours: number
          orders_resulted: number
          pct_over_72h: number
        }[]
      }
      lab_partner_upload_result: {
        Args: {
          p_file_path: string
          p_file_size_bytes: number
          p_mime_type: string
          p_note: string
          p_order_id: string
          p_original_filename: string
        }
        Returns: string
      }
      lab_provider_turnaround_stats: {
        Args: { p_days?: number }
        Returns: {
          avg_turnaround_hours: number
          median_turnaround_hours: number
          orders_resulted: number
          pct_over_72h: number
          provider_id: string
          provider_name: string
          suppressed: boolean
        }[]
      }
      log_patient_record_view: {
        Args: { p_patient_id: string }
        Returns: undefined
      }
      mark_emergency_contact_notified: {
        Args: { p_actor_id: string; p_event_id: string }
        Returns: undefined
      }
      mark_identity_verified: {
        Args: {
          p_actor_id: string
          p_patient_id: string
          p_verified_at: string
        }
        Returns: undefined
      }
      mark_lab_order_transmitted: {
        Args: {
          p_note?: string
          p_order_id: string
          p_partner_reference?: string
        }
        Returns: Json
      }
      match_lpe_content_blocks: {
        Args: {
          filter_condition?: Database["public"]["Enums"]["care_plan_condition"]
          filter_module?: Database["public"]["Enums"]["lpe_module"]
          match_count?: number
          query_embedding: string
        }
        Returns: {
          body_md: string
          condition: Database["public"]["Enums"]["care_plan_condition"]
          id: string
          key: string
          module: Database["public"]["Enums"]["lpe_module"]
          similarity: number
          title: string
        }[]
      }
      match_partner_statement: {
        Args: { p_statement_id: string }
        Returns: Json
      }
      mint_health_passport: {
        Args: { p_attestation_request_id?: string }
        Returns: Json
      }
      my_care_graph: { Args: never; Returns: Json }
      my_care_plan_clinicians: {
        Args: never
        Returns: {
          care_plan_id: string
          clinician_full_name: string
        }[]
      }
      open_health_check: { Args: never; Returns: string }
      patient_health_reset_progress: {
        Args: never
        Returns: {
          baseline_done: boolean
          completed_at: string
          consistency_done: boolean
          day_number: number
          programme_set_done: boolean
          reset_id: string
          started_at: string
          trial_claimed_at: string
        }[]
      }
      patient_monitoring_latest_readings: {
        Args: { p_patient_ids: string[] }
        Returns: {
          bp_taken_at: string
          diastolic: number
          glucose_mmol_l: number
          glucose_taken_at: string
          hrv_ms: number
          open_alert_count: number
          open_alert_level: Database["public"]["Enums"]["alert_level"]
          patient_id: string
          pulse_bpm: number
          pulse_taken_at: string
          sleep_minutes: number
          spo2_pct: number
          spo2_taken_at: string
          steps: number
          systolic: number
          temperature_c: number
          temperature_taken_at: string
          wearable_last_synced_at: string
          weight_kg: number
          weight_taken_at: string
        }[]
      }
      pharmacist_dispense_history: {
        Args: { p_limit?: number }
        Returns: {
          dispense_id: string
          dispensed_on: string
          drug_name: string
          patient_name: string
          quantity: string
        }[]
      }
      pharmacist_order_allergies: {
        Args: { p_order_id: string }
        Returns: {
          allergen: string
          reaction: string
          severity: string
        }[]
      }
      pharmacist_order_medications: {
        Args: { p_order_id: string }
        Returns: {
          dose: string
          drug_name: string
          frequency: string
        }[]
      }
      pharmacist_orders: {
        Args: never
        Returns: {
          items: Json
          order_id: string
          order_number: string
          patient_name: string
          patient_number: string
          requested_at: string
          status: string
        }[]
      }
      pharmacist_own_partner_id: { Args: never; Returns: string }
      pharmacist_profile: {
        Args: never
        Returns: {
          city: string
          contact_email: string
          contact_phone: string
          delivery: boolean
          license_expires_at: string
          license_number: string
          name: string
          regions: string[]
          state: string
        }[]
      }
      pharmacist_record_dispense: {
        Args: {
          p_dispensed_on: string
          p_drug_name: string
          p_order_id: string
          p_quantity: string
        }
        Returns: undefined
      }
      pharmacist_update_profile: {
        Args: {
          p_city: string
          p_contact_email: string
          p_contact_phone: string
          p_delivery: boolean
          p_license_expires_at: string
          p_license_number: string
          p_name: string
          p_regions: string[]
          p_state: string
        }
        Returns: undefined
      }
      post_care_message: {
        Args: { p_body: string; p_thread_id: string }
        Returns: string
      }
      price_review_for_patient: {
        Args: { p_bundle_code: string; p_patient_id: string }
        Returns: Json
      }
      propose_video_visit_alternate_slots: {
        Args: { p_request_id: string; p_slot_ids: string[] }
        Returns: undefined
      }
      provision_dependent_profile_basics: {
        Args: {
          p_actor_id: string
          p_child_id: string
          p_date_of_birth: string
          p_sex: Database["public"]["Enums"]["sex"]
        }
        Returns: undefined
      }
      public_partner_locations: {
        Args: never
        Returns: {
          address: string
          id: string
          latitude: number
          longitude: number
          name: string
          regions: string[]
          type: string
        }[]
      }
      public_price_list: {
        Args: never
        Returns: {
          billing_interval: Database["public"]["Enums"]["billing_interval"]
          code: string
          currency: Database["public"]["Enums"]["currency"]
          price_minor: number
        }[]
      }
      public_response_commitments: { Args: never; Returns: Json }
      public_service_coverage: { Args: never; Returns: Json }
      purchase_care_voucher: {
        Args: {
          p_beneficiary: string
          p_gift_message?: string
          p_panel_bundle_id: string
        }
        Returns: Json
      }
      purchase_subscription_voucher: {
        Args: {
          p_beneficiary: string
          p_gift_message?: string
          p_plan_id: string
        }
        Returns: Json
      }
      raise_lab_extraction_alert: {
        Args: {
          p_document_id: string
          p_level: Database["public"]["Enums"]["alert_level"]
          p_reason: string
        }
        Returns: boolean
      }
      record_voucher_payment_intent: {
        Args: {
          p_amount_minor: number
          p_credit_kobo: number
          p_currency: string
          p_provider: Database["public"]["Enums"]["payment_provider"]
          p_reference: string
          p_voucher: string
        }
        Returns: string
      }
      record_wearable_step_count: {
        Args: {
          p_logged_on: string
          p_organisation_id: string
          p_patient_id: string
          p_step_count: number
        }
        Returns: boolean
      }
      redeem_care_voucher: {
        Args: { p_order_id: string; p_order_type: string; p_voucher: string }
        Returns: Json
      }
      redeem_referral_code: { Args: { p_code: string }; Returns: Json }
      redeem_subscription_voucher: {
        Args: { p_voucher_id: string }
        Returns: Json
      }
      redeem_wellness_points: { Args: { p_points: number }; Returns: Json }
      region_service_available: {
        Args: { p_service: string; p_state: string }
        Returns: boolean
      }
      register_passport_signing_key: {
        Args: { p_activate?: boolean; p_kid: string; p_public_key_spki: string }
        Returns: undefined
      }
      report_exposure: {
        Args: {
          p_detail?: string
          p_exposure_code: string
          p_occurred_on?: string
          p_patient_id: string
        }
        Returns: Json
      }
      request_health_passport_attestation: {
        Args: { p_note?: string; p_purpose: string }
        Returns: string
      }
      request_lab_order_partner_visit: {
        Args: {
          p_facility_id: string
          p_order_id: string
          p_preferred_time_of_day: Database["public"]["Enums"]["lab_order_time_of_day"]
          p_scheduled_date: string
        }
        Returns: {
          applied_voucher_id: string | null
          courier_reference: string | null
          created_at: string
          excluded_test_codes: Json
          facility_id: string | null
          fulfilment: Database["public"]["Enums"]["fulfilment_mode"]
          home_visit_provider_id: string | null
          home_visit_scheduled_at: string | null
          id: string
          investigation_tier: number
          order_number: string | null
          ordered_at: string
          ordered_by: string | null
          organisation_id: string
          origin: Database["public"]["Enums"]["booking_origin"]
          panel_bundle_id: string | null
          partner_cost_breakdown: Json | null
          partner_cost_kobo: number | null
          partner_cost_provider_id: string | null
          partner_reference: string | null
          patient_id: string
          payable_kobo: number | null
          payment_confirmed_at: string | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          preferred_time_of_day:
            | Database["public"]["Enums"]["lab_order_time_of_day"]
            | null
          provider_id: string | null
          resulted_at: string | null
          scheduled_date: string | null
          screening_schedule_id: string | null
          status: Database["public"]["Enums"]["lab_order_status"]
          subscriber_discount_kobo: number
          total_kobo: number
          transmission: Database["public"]["Enums"]["lab_order_transmission"]
          transmission_ack_at: string | null
          transmission_note: string | null
          transmitted_at: string | null
          updated_at: string
          voucher_covered_kobo: number
        }
        SetofOptions: {
          from: "*"
          to: "lab_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_lab_order_refund: {
        Args: {
          p_amount_kobo?: number
          p_detail?: string
          p_order_id: string
          p_reason: Database["public"]["Enums"]["lab_refund_reason"]
        }
        Returns: Json
      }
      request_masked_call: {
        Args: {
          p_context: Database["public"]["Enums"]["masked_call_context"]
          p_escalation_id?: string
          p_patient_id: string
          p_staff_profile_id: string
        }
        Returns: string
      }
      resolve_personalised_lifestyle_goal: {
        Args: {
          p_goal_id: string
          p_status: Database["public"]["Enums"]["lpe_goal_status"]
        }
        Returns: {
          created_at: string
          goal_template_id: string | null
          id: string
          metric_key: string | null
          module: Database["public"]["Enums"]["lpe_module"]
          organisation_id: string
          personalised: boolean
          programme_instance_id: string
          status: Database["public"]["Enums"]["lpe_goal_status"]
          target: Json | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lpe_goal_instances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_to_care_access_request: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: {
          counterparty_user_id: string
          created_at: string
          id: string
          initiated_by: string
          permission_level: Database["public"]["Enums"]["profile_access_level"]
          profile_id: string
          relationship: string | null
          responded_at: string | null
          responded_by: string | null
          status: Database["public"]["Enums"]["care_access_request_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "care_access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retire_passport_signing_key: {
        Args: { p_kid: string }
        Returns: undefined
      }
      revoke_care_access: { Args: { p_grant_id: string }; Returns: Json }
      revoke_clinical_staff_credential_verification: {
        Args: { p_clinical_staff_id: string; p_reason?: string }
        Returns: undefined
      }
      revoke_emergency_card: { Args: never; Returns: undefined }
      revoke_health_passport: {
        Args: { p_issuance_id: string; p_reason?: string }
        Returns: undefined
      }
      seal_health_passport: {
        Args: {
          p_content_digest: string
          p_content_snapshot: Json
          p_issuance_id: string
          p_kid: string
          p_signature: string
          p_signed_payload: string
        }
        Returns: undefined
      }
      select_video_visit_alternate_slot: {
        Args: { p_request_id: string; p_slot_id: string }
        Returns: string
      }
      set_lab_order_facility: {
        Args: { p_facility_id: string; p_order_id: string }
        Returns: {
          applied_voucher_id: string | null
          courier_reference: string | null
          created_at: string
          excluded_test_codes: Json
          facility_id: string | null
          fulfilment: Database["public"]["Enums"]["fulfilment_mode"]
          home_visit_provider_id: string | null
          home_visit_scheduled_at: string | null
          id: string
          investigation_tier: number
          order_number: string | null
          ordered_at: string
          ordered_by: string | null
          organisation_id: string
          origin: Database["public"]["Enums"]["booking_origin"]
          panel_bundle_id: string | null
          partner_cost_breakdown: Json | null
          partner_cost_kobo: number | null
          partner_cost_provider_id: string | null
          partner_reference: string | null
          patient_id: string
          payable_kobo: number | null
          payment_confirmed_at: string | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          preferred_time_of_day:
            | Database["public"]["Enums"]["lab_order_time_of_day"]
            | null
          provider_id: string | null
          resulted_at: string | null
          scheduled_date: string | null
          screening_schedule_id: string | null
          status: Database["public"]["Enums"]["lab_order_status"]
          subscriber_discount_kobo: number
          total_kobo: number
          transmission: Database["public"]["Enums"]["lab_order_transmission"]
          transmission_ack_at: string | null
          transmission_note: string | null
          transmitted_at: string | null
          updated_at: string
          voucher_covered_kobo: number
        }
        SetofOptions: {
          from: "*"
          to: "lab_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_patient_reported_diabetes_type: {
        Args: { p_type: Database["public"]["Enums"]["diabetes_type"] }
        Returns: undefined
      }
      set_pharmacy_order_delivery_address: {
        Args: { p_address: Json; p_order_id: string }
        Returns: boolean
      }
      set_referral_specialist_provider: {
        Args: { p_referral_id: string; p_specialist_provider_id: string }
        Returns: {
          applied_voucher_id: string | null
          appointment_date: string | null
          booking_confirmed_at: string | null
          clinical_summary: Json | null
          created_at: string
          fulfilment: Database["public"]["Enums"]["fulfilment_mode"]
          id: string
          interim_management_plan: string | null
          organisation_id: string
          origin: Database["public"]["Enums"]["booking_origin"]
          patient_id: string
          payable_kobo: number | null
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          referral_fee_kobo: number
          referral_number: string | null
          referral_reason: string | null
          screening_upgrade_id: string | null
          set_by: string | null
          shared_care_handback_at: string | null
          specialist_provider_id: string | null
          specialist_type: Database["public"]["Enums"]["specialist_type"]
          status: Database["public"]["Enums"]["referral_status"]
          treatment_plan_note: string | null
          treatment_plan_received_at: string | null
          updated_at: string
          urgency: Database["public"]["Enums"]["referral_urgency"] | null
          voucher_covered_kobo: number
          waitlisted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "specialist_referrals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_usd_processing_fee: { Args: { p_fee_pct: number }; Returns: Json }
      set_usd_reference_rate: { Args: { p_ngn_per_usd: number }; Returns: Json }
      sign_cv_risk_config: { Args: { p_config_id: string }; Returns: string }
      sign_escalation_slas: { Args: { p_id: string }; Returns: string }
      sign_risk_questionnaire_config: {
        Args: { p_config_id: string }
        Returns: string
      }
      sign_vaccination_schedule: {
        Args: { p_signoff_id: string }
        Returns: string
      }
      sponsor_book_care: {
        Args: {
          p_beneficiary: string
          p_bundle_code: string
          p_facility_id?: string
        }
        Returns: Json
      }
      sponsor_care_status: { Args: { p_beneficiary: string }; Returns: Json }
      sponsor_payable_orders: { Args: { p_beneficiary: string }; Returns: Json }
      sponsor_request_refill: {
        Args: { p_beneficiary: string; p_medication_id: string }
        Returns: string
      }
      sponsor_set_dependent_basics: {
        Args: {
          p_beneficiary: string
          p_city?: string
          p_date_of_birth?: string
          p_sex?: string
          p_state?: string
        }
        Returns: Json
      }
      start_care_thread: {
        Args: {
          p_body: string
          p_care_plan_id?: string
          p_escalation_id?: string
          p_patient_id?: string
          p_subject: string
        }
        Returns: string
      }
      touch_last_active: { Args: never; Returns: undefined }
      upsert_lab_report_template: {
        Args: {
          p_hints?: Json
          p_lab_name: string
          p_lab_name_key: string
          p_layout_fingerprint: string
          p_readings_proposed?: number
        }
        Returns: string
      }
      verify_clinical_staff_credential: {
        Args: { p_clinical_staff_id: string }
        Returns: undefined
      }
      video_visit_acceptance_stats: { Args: never; Returns: Json }
      wellness_challenge_progress: {
        Args: { p_enrolment_id: string }
        Returns: Json
      }
      withdraw_health_passport_attestation: {
        Args: { p_request_id: string }
        Returns: undefined
      }
    }
    Enums: {
      activity_entry_type: "steps" | "workout"
      alert_level:
        | "routine"
        | "clinician_review"
        | "urgent_escalation"
        | "emergency"
      alert_status: "open" | "acknowledged" | "resolved"
      allergy_severity: "mild" | "moderate" | "severe"
      allergy_source: "patient" | "clinician" | "fhir_import"
      annual_check_status: "pending" | "in_progress" | "completed"
      annual_review_stage:
        | "due"
        | "questionnaire"
        | "labs"
        | "medication_review"
        | "risk_score"
        | "care_plan"
        | "video_consult"
        | "completed"
      annual_review_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "cancelled"
      annual_review_workup_status:
        | "pending"
        | "ordered"
        | "completed"
        | "not_applicable"
      appetite_level: "normal" | "reduced" | "none"
      appointment_status: "scheduled" | "completed" | "cancelled" | "no_show"
      async_consult_status: "submitted" | "in_review" | "answered" | "closed"
      bariatric_referral_status:
        | "proposed"
        | "referred"
        | "workup"
        | "scheduled"
        | "completed"
        | "declined"
        | "not_eligible"
      billing_interval: "monthly" | "yearly"
      blood_group: "O+" | "O-" | "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-"
      booking_origin: "patient_initiated" | "clinically_triggered"
      booking_request_status:
        | "requested"
        | "confirmed"
        | "completed"
        | "cancelled"
      broadcast_audience:
        | "all_patients"
        | "patients_by_state"
        | "subscribers_by_plan"
        | "all_partners"
        | "partners_by_type"
      broadcast_status: "draft" | "sent"
      care_access_event_kind:
        | "granted"
        | "permission_changed"
        | "clinical_access_granted"
        | "clinical_access_withdrawn"
        | "revoked"
        | "record_viewed"
        | "receipt_generated"
        | "acted_for"
      care_access_request_status:
        | "pending"
        | "accepted"
        | "declined"
        | "cancelled"
      care_message_author: "patient" | "care_team" | "sponsor"
      care_message_thread_status: "open" | "closed"
      care_plan_condition:
        | "hypertension"
        | "diabetes"
        | "obesity"
        | "ckd"
        | "cardiovascular"
        | "other"
        | "asthma"
        | "copd"
        | "heart_failure"
      care_plan_recommendation_status: "proposed" | "accepted" | "dismissed"
      care_plan_review_prompt_status: "open" | "actioned" | "dismissed"
      care_plan_review_trigger_event:
        | "abnormal_lab_result"
        | "missed_medication"
        | "new_diagnosis"
        | "risk_tier_change"
        | "hospital_discharge"
      care_plan_status: "draft" | "active" | "completed" | "cancelled"
      care_voucher_event_type:
        | "created"
        | "payment_applied"
        | "activated"
        | "redeemed"
        | "expired"
        | "extended"
        | "cancelled"
      care_voucher_kind: "prepaid_service" | "reward_discount"
      care_voucher_status:
        | "reserved"
        | "active"
        | "redeemed"
        | "expired"
        | "cancelled"
      case_brief_status: "generated" | "failed"
      case_review_action_status:
        | "proposed"
        | "confirmed"
        | "modified"
        | "dismissed"
        | "superseded"
      case_review_action_type:
        | "log_review_note"
        | "schedule_follow_up"
        | "confirm_medication_refill"
        | "order_investigation"
        | "resolve_case"
      case_review_authority:
        | "any_clinical_tier"
        | "refill_confirmation"
        | "prescribing"
        | "emergency_resolution"
      chronic_control_state:
        | "at_target"
        | "above_target"
        | "not_yet_established"
      chronic_enrolment_source: "recommended" | "staff" | "clinician"
      chronic_enrolment_status: "enrolled" | "completed" | "withdrawn"
      clinical_severity: "mild" | "moderate" | "severe"
      commission_rate_type: "percentage" | "flat"
      commission_status: "pending" | "confirmed" | "paid"
      commission_type:
        | "lab"
        | "pharmacy"
        | "referral"
        | "home_visit"
        | "delivery"
      complication_check_type: "retinal" | "renal"
      condition_clinical_status:
        | "suspected"
        | "under_investigation"
        | "active"
        | "controlled"
        | "uncontrolled"
        | "resolved"
        | "historical"
      consent_type: "data_processing" | "telehealth" | "terms_of_service"
      contract_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "paid"
        | "active"
      currency: "NGN" | "GBP" | "USD"
      device_catalog_category:
        | "blood_pressure"
        | "weight"
        | "blood_glucose"
        | "band"
      device_catalog_fulfillment_type: "recommend_only" | "tarragon_owned"
      device_catalog_pairing_path:
        | "ble_open_gatt"
        | "ble_vendor_sdk"
        | "health_connect_bridge"
        | "manual_only"
      diabetes_type: "type_1" | "type_2" | "gestational" | "other"
      dispense_source: "patient" | "pharmacy"
      doctor_tier:
        | "care_coordinator"
        | "tier_1"
        | "tier_2"
        | "tier_3"
        | "tier_4_senior_registrar"
        | "tier_5_partner_specialist"
      ecg_report_document_source:
        | "patient"
        | "lab_liaison"
        | "clinician"
        | "admin"
      emergency_event_status: "active" | "acknowledged" | "resolved"
      emergency_source:
        | "danger_symptom_checklist"
        | "symptom_log"
        | "ai_coach"
        | "intake_screen"
        | "bp_reading"
        | "glucose_red_flag"
        | "spo2_red_flag"
        | "temperature_red_flag"
        | "exposure_report"
      employer_roster_status: "pending" | "claimed" | "removed"
      escalation_status: "open" | "under_review" | "resolved" | "referred"
      exposure_report_status: "open" | "completed" | "withdrawn"
      facility_type:
        | "hospital"
        | "lab"
        | "pharmacy"
        | "radiology"
        | "optician"
        | "vaccination_centre"
      family_relationship:
        | "mother"
        | "father"
        | "sibling"
        | "child"
        | "maternal_grandmother"
        | "maternal_grandfather"
        | "paternal_grandmother"
        | "paternal_grandfather"
        | "aunt_or_uncle"
        | "other"
      fhir_import_resource_status:
        | "proposed"
        | "confirmed"
        | "modified"
        | "dismissed"
        | "superseded"
      fhir_import_resource_type:
        | "Observation"
        | "AllergyIntolerance"
        | "MedicationStatement"
        | "MedicationRequest"
        | "Immunization"
      foot_risk_class: "low" | "increased" | "high" | "active"
      foot_sensation: "normal" | "reduced" | "absent"
      fulfilment_mode: "partner" | "self_arranged"
      glucose_context:
        | "fasting"
        | "random"
        | "post_meal"
        | "pre_meal"
        | "bedtime"
        | "night"
      glycaemic_target_category: "tight" | "standard" | "relaxed"
      haemoglobin_genotype: "AA" | "AS" | "AC" | "SS" | "SC" | "CC" | "other"
      hbv_status:
        | "unknown"
        | "hbv_negative"
        | "chronic_hbv"
        | "immune"
        | "susceptible"
        | "vaccinated_pending"
        | "non_responder"
      hcv_status:
        | "unknown"
        | "hcv_negative"
        | "hcv_rna_pending"
        | "hcv_active"
        | "hcv_cleared"
      health_education_category:
        | "hypertension"
        | "diabetes"
        | "weight"
        | "heart"
        | "kidney"
        | "respiratory"
        | "cancer_screening"
        | "womens_health"
        | "mens_health"
        | "mental_health"
        | "nutrition"
        | "medicines"
        | "family_child"
        | "getting_started"
      health_education_content_type: "article" | "video"
      health_education_status: "seen" | "understood" | "needs_review"
      health_passport_attestation_status:
        | "pending"
        | "attested"
        | "declined"
        | "withdrawn"
      health_passport_status: "unsigned" | "valid" | "superseded" | "revoked"
      hiv_status: "unknown" | "hiv_negative" | "hiv_positive"
      hospital_admission_source: "patient_reported" | "staff_recorded"
      identity_method: "nin" | "bvn" | "document"
      identity_verification_status: "pending" | "verified" | "failed"
      insulin_type:
        | "soluble"
        | "nph"
        | "premixed"
        | "analogue_rapid"
        | "analogue_long"
      lab_analyte_flag:
        | "normal"
        | "low"
        | "high"
        | "critical_low"
        | "critical_high"
      lab_monitoring_status: "pending" | "completed" | "cancelled"
      lab_order_status:
        | "pending_payment"
        | "payment_confirmed"
        | "ordered"
        | "sample_collected"
        | "processing"
        | "resulted"
        | "cancelled"
      lab_order_time_of_day: "morning" | "afternoon" | "evening"
      lab_order_transmission:
        | "not_required"
        | "awaiting_payment"
        | "queued"
        | "sent"
        | "acknowledged"
        | "failed"
      lab_refund_reason:
        | "patient_cancelled"
        | "never_attended"
        | "sample_rejected"
        | "partially_run"
        | "result_lost"
        | "duplicate_order"
        | "clinically_withdrawn"
      lab_refund_status: "requested" | "approved" | "rejected" | "paid"
      lab_result_document_source:
        | "patient"
        | "lab_liaison"
        | "clinician"
        | "admin"
        | "lab_partner"
      lead_role: "patient" | "family" | "employer" | "hmo" | "other"
      lpe_enrollment_status:
        | "draft"
        | "active"
        | "paused"
        | "maintenance"
        | "disengaged"
        | "completed"
      lpe_goal_status: "active" | "achieved" | "softened" | "abandoned"
      lpe_measurement_source: "app" | "web" | "coordinator" | "device"
      lpe_measurement_type:
        | "bp"
        | "glucose"
        | "weight"
        | "waist"
        | "bmi_derived"
        | "activity_minutes"
        | "steps"
        | "strength_session"
        | "food_log"
        | "mood"
        | "sleep"
        | "ketones"
        | "insulin_dose"
        | "med_adherence"
        | "foot_check"
        | "symptom"
        | "side_effect"
      lpe_module: "diet" | "activity" | "behaviour" | "sleep" | "stress"
      lpe_phase_kind:
        | "foundation"
        | "build"
        | "strengthen"
        | "maintenance"
        | "continuous"
      lpe_phase_status: "pending" | "active" | "completed"
      lpe_red_flag_action:
        | "supportive_reply"
        | "same_day_review"
        | "auto_pause_weightloss"
        | "page_oncall"
        | "refer"
      lpe_red_flag_severity: "amber" | "red" | "emergency"
      lpe_red_flag_status: "open" | "stood_down"
      lpe_task_channel: "app" | "whatsapp_reminder"
      lpe_task_status: "pending" | "done" | "missed" | "skipped"
      masked_call_context:
        | "care_coordination"
        | "clinical_follow_up"
        | "escalation_contact"
      masked_call_participant_role: "patient" | "staff"
      masked_call_session_status:
        | "requested"
        | "active"
        | "closed"
        | "expired"
        | "failed"
      meal_type: "breakfast" | "lunch" | "dinner" | "snack"
      med_adherence_alert_level: "coach" | "doctor"
      med_adherence_alert_status: "open" | "acknowledged" | "resolved"
      medication_checkin_status: "pending" | "responded" | "skipped"
      medication_checkin_type:
        | "started"
        | "side_effects"
        | "missed_doses"
        | "lab_review"
      medication_log_status: "taken" | "missed" | "skipped"
      medication_review_status: "pending" | "completed" | "cancelled"
      medication_source: "clinician" | "patient" | "specialist" | "fhir_import"
      notification_channel:
        | "email"
        | "sms"
        | "in_app"
        | "whatsapp"
        | "push"
        | "voice"
      notification_content_class: "clinical" | "non_clinical"
      notification_priority: "routine" | "critical"
      notification_status: "pending" | "sent" | "delivered" | "failed" | "read"
      obesity_bmi_category:
        | "underweight"
        | "healthy"
        | "overweight"
        | "obesity_class_i"
        | "obesity_class_ii"
        | "obesity_class_iii"
      obesity_clinical_status: "preclinical" | "clinical"
      obesity_waist_risk: "normal" | "raised" | "high"
      organisation_type:
        | "clinic"
        | "hmo"
        | "corporate"
        | "lab"
        | "pharmacy"
        | "direct_consumer"
        | "protocol_partner"
      outcomes_contract_type: "fee_at_risk" | "flat"
      outreach_contact_channel: "call" | "whatsapp"
      outreach_task_status:
        | "open"
        | "in_progress"
        | "contacted"
        | "resolved"
        | "dismissed"
      outreach_trigger_type:
        | "high_risk_score"
        | "overdue_screening"
        | "stale_monitoring"
        | "unactioned_abnormal"
        | "awaiting_result"
      partner_revenue_treatment: "net_agent" | "gross_principal"
      partner_statement_line_resolution:
        | "unmatched"
        | "agreed"
        | "overcharged"
        | "undercharged"
        | "not_ordered"
        | "not_delivered"
      partner_statement_status:
        | "draft"
        | "matched"
        | "disputed"
        | "approved"
        | "settled"
      patient_device_status: "active" | "unpaired"
      patient_device_type:
        | "bp_cuff"
        | "glucometer"
        | "scale"
        | "thermometer"
        | "pulse_oximeter"
      payment_provider: "paystack" | "stripe" | "wallet" | "voucher"
      payment_transaction_type:
        | "charge.success"
        | "charge.failed"
        | "subscription.create"
        | "subscription.disable"
        | "subscription.not_renew"
        | "invoice.create"
        | "invoice.update"
        | "invoice.payment_failed"
        | "other"
        | "invoice.payment_succeeded"
        | "checkout.session.completed"
        | "customer.subscription.created"
        | "customer.subscription.updated"
        | "customer.subscription.deleted"
      pharmacy_fulfilment_method: "pickup" | "delivery"
      pharmacy_order_status:
        | "pending_payment"
        | "payment_confirmed"
        | "requested"
        | "confirmed"
        | "dispensed"
        | "out_for_delivery"
        | "delivered"
        | "cancelled"
      prevention_condition:
        | "hypertension"
        | "diabetes"
        | "cvd"
        | "breast_ca"
        | "cervical_ca"
        | "colorectal_ca"
        | "prostate_ca"
        | "other"
        | "ckd"
        | "asthma_copd"
        | "mental_wellbeing"
      prevention_campaign_action_type:
        | "education"
        | "screening_invite"
        | "assessment"
        | "discount"
        | "challenge"
      prevention_campaign_enrolment_status: "invited" | "joined" | "completed" | "declined"
      prevention_campaign_status: "draft" | "active" | "ended"
      preventive_enrolment_source: "recommended" | "self" | "staff"
      preventive_enrolment_status: "enrolled" | "completed" | "withdrawn"
      profile_access_level: "view" | "manage"
      reassessment_reason:
        | "new_diagnosis"
        | "abnormal_result"
        | "hospital_discharge"
        | "pregnancy_life_stage"
        | "major_weight_change"
      referral_reward_status: "pending" | "earned" | "paid"
      referral_status:
        | "pending_payment"
        | "payment_confirmed"
        | "pending"
        | "waitlisted"
        | "booked"
        | "confirmed"
        | "completed"
        | "declined"
      referral_type:
        | "patient_refers_patient"
        | "doctor_refers_patient"
        | "corporate_champion"
      referral_urgency: "routine" | "priority" | "urgent"
      reminder_stage: "upcoming" | "due" | "overdue" | "escalated"
      reproductive_life_stage:
        | "menstruating"
        | "trying_to_conceive"
        | "pregnant"
        | "postpartum"
        | "perimenopausal"
        | "menopausal"
        | "not_applicable"
      result_status: "normal" | "borderline" | "abnormal" | "critical"
      risk_assessment_category:
        | "lifestyle"
        | "family_history"
        | "pmh"
        | "meds"
        | "vaccination"
        | "screening_history"
      risk_confidence: "low" | "moderate" | "high"
      risk_level: "low" | "moderate" | "high" | "very_high" | "unknown"
      screen_applicability: "all" | "male" | "female"
      screen_price_source:
        | "lab_price_list"
        | "provisional"
        | "contracted"
        | "derived_from_panel_total"
      screening_status:
        | "pending"
        | "booked"
        | "completed"
        | "overdue"
        | "cancelled"
      sex: "male" | "female"
      specialist_type:
        | "urologist"
        | "oncologist"
        | "ob_gyn"
        | "cardiology"
        | "endocrinology"
        | "nephrology"
        | "ophthalmology"
        | "dietetics"
        | "podiatry"
        | "other"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled"
      symptom_type:
        | "pain"
        | "fatigue"
        | "breathlessness"
        | "dizziness"
        | "palpitations"
        | "swelling"
        | "nausea"
        | "other"
        | "chest_pain"
        | "severe_headache"
        | "visual_disturbance"
        | "confusion"
      timeline_event_type:
        | "lab_completed"
        | "lab_abnormal"
        | "medication_started"
        | "medication_stopped"
        | "medication_missed"
        | "referral_created"
        | "referral_status_changed"
        | "screening_due"
        | "screening_completed"
        | "vaccination_recorded"
        | "escalation_raised"
        | "escalation_resolved"
        | "care_plan_updated"
        | "admission_recorded"
        | "discharge_recorded"
        | "message_posted"
        | "medication_dispensed"
        | "encounter_documented"
        | "condition_recorded"
        | "condition_status_changed"
        | "medication_received"
      upgrade_condition:
        | "hypertension"
        | "diabetes"
        | "cancer_referral"
        | "other"
      user_role:
        | "patient"
        | "clinician"
        | "admin"
        | "hmo_admin"
        | "corporate_admin"
        | "care_coordinator"
        | "pharmacist"
        | "analyst"
        | "lab_liaison"
        | "finance"
        | "lab_partner"
      vaccination_verification_status:
        | "self_reported"
        | "pending_verification"
        | "verified"
        | "rejected"
      video_consultation_context:
        | "pre_referral_triage"
        | "specialist_consult"
        | "annual_review"
        | "general_checkin"
      video_consultation_status:
        | "scheduled"
        | "started"
        | "completed"
        | "cancelled"
        | "no_show"
      video_visit_request_status:
        | "requested"
        | "pending_payment"
        | "payment_confirmed"
        | "accepted"
        | "declined"
        | "expired"
        | "cancelled"
        | "refunded"
        | "alternate_proposed"
      vital_source: "manual" | "device" | "wearable" | "cgm" | "fhir_import"
      vital_type:
        | "blood_pressure"
        | "glucose"
        | "weight"
        | "pulse"
        | "temperature"
        | "spo2"
        | "waist_circumference"
        | "ketones"
        | "respiratory_rate"
        | "peak_flow"
      wearable_connection_status: "active" | "disconnected" | "error"
      wearable_provider:
        | "apple_health"
        | "oura"
        | "whoop"
        | "garmin"
        | "fitbit"
        | "dexcom"
        | "libre"
        | "android_health_connect"
      wellness_challenge_metric:
        | "vitals_logs"
        | "meal_logs"
        | "adherence_checkins"
        | "lpe_tasks"
        | "education_lessons"
      wellness_challenge_status: "active" | "completed" | "expired"
      wellness_class_registration_status:
        | "registered"
        | "attended"
        | "no_show"
        | "cancelled"
      wellness_class_type: "virtual" | "in_person"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_entry_type: ["steps", "workout"],
      alert_level: [
        "routine",
        "clinician_review",
        "urgent_escalation",
        "emergency",
      ],
      alert_status: ["open", "acknowledged", "resolved"],
      allergy_severity: ["mild", "moderate", "severe"],
      allergy_source: ["patient", "clinician", "fhir_import"],
      annual_check_status: ["pending", "in_progress", "completed"],
      annual_review_stage: [
        "due",
        "questionnaire",
        "labs",
        "medication_review",
        "risk_score",
        "care_plan",
        "video_consult",
        "completed",
      ],
      annual_review_status: [
        "pending",
        "in_progress",
        "completed",
        "cancelled",
      ],
      annual_review_workup_status: [
        "pending",
        "ordered",
        "completed",
        "not_applicable",
      ],
      appetite_level: ["normal", "reduced", "none"],
      appointment_status: ["scheduled", "completed", "cancelled", "no_show"],
      async_consult_status: ["submitted", "in_review", "answered", "closed"],
      bariatric_referral_status: [
        "proposed",
        "referred",
        "workup",
        "scheduled",
        "completed",
        "declined",
        "not_eligible",
      ],
      billing_interval: ["monthly", "yearly"],
      blood_group: ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"],
      booking_origin: ["patient_initiated", "clinically_triggered"],
      booking_request_status: [
        "requested",
        "confirmed",
        "completed",
        "cancelled",
      ],
      broadcast_audience: [
        "all_patients",
        "patients_by_state",
        "subscribers_by_plan",
        "all_partners",
        "partners_by_type",
      ],
      broadcast_status: ["draft", "sent"],
      care_access_event_kind: [
        "granted",
        "permission_changed",
        "clinical_access_granted",
        "clinical_access_withdrawn",
        "revoked",
        "record_viewed",
        "receipt_generated",
        "acted_for",
      ],
      care_access_request_status: [
        "pending",
        "accepted",
        "declined",
        "cancelled",
      ],
      care_message_author: ["patient", "care_team", "sponsor"],
      care_message_thread_status: ["open", "closed"],
      care_plan_condition: [
        "hypertension",
        "diabetes",
        "obesity",
        "ckd",
        "cardiovascular",
        "other",
        "asthma",
        "copd",
        "heart_failure",
      ],
      care_plan_recommendation_status: ["proposed", "accepted", "dismissed"],
      care_plan_review_prompt_status: ["open", "actioned", "dismissed"],
      care_plan_review_trigger_event: [
        "abnormal_lab_result",
        "missed_medication",
        "new_diagnosis",
        "risk_tier_change",
        "hospital_discharge",
      ],
      care_plan_status: ["draft", "active", "completed", "cancelled"],
      care_voucher_event_type: [
        "created",
        "payment_applied",
        "activated",
        "redeemed",
        "expired",
        "extended",
        "cancelled",
      ],
      care_voucher_kind: ["prepaid_service", "reward_discount"],
      care_voucher_status: [
        "reserved",
        "active",
        "redeemed",
        "expired",
        "cancelled",
      ],
      case_brief_status: ["generated", "failed"],
      case_review_action_status: [
        "proposed",
        "confirmed",
        "modified",
        "dismissed",
        "superseded",
      ],
      case_review_action_type: [
        "log_review_note",
        "schedule_follow_up",
        "confirm_medication_refill",
        "order_investigation",
        "resolve_case",
      ],
      case_review_authority: [
        "any_clinical_tier",
        "refill_confirmation",
        "prescribing",
        "emergency_resolution",
      ],
      chronic_control_state: [
        "at_target",
        "above_target",
        "not_yet_established",
      ],
      chronic_enrolment_source: ["recommended", "staff", "clinician"],
      chronic_enrolment_status: ["enrolled", "completed", "withdrawn"],
      clinical_severity: ["mild", "moderate", "severe"],
      commission_rate_type: ["percentage", "flat"],
      commission_status: ["pending", "confirmed", "paid"],
      commission_type: [
        "lab",
        "pharmacy",
        "referral",
        "home_visit",
        "delivery",
      ],
      complication_check_type: ["retinal", "renal"],
      condition_clinical_status: [
        "suspected",
        "under_investigation",
        "active",
        "controlled",
        "uncontrolled",
        "resolved",
        "historical",
      ],
      consent_type: ["data_processing", "telehealth", "terms_of_service"],
      contract_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "paid",
        "active",
      ],
      currency: ["NGN", "GBP", "USD"],
      device_catalog_category: [
        "blood_pressure",
        "weight",
        "blood_glucose",
        "band",
      ],
      device_catalog_fulfillment_type: ["recommend_only", "tarragon_owned"],
      device_catalog_pairing_path: [
        "ble_open_gatt",
        "ble_vendor_sdk",
        "health_connect_bridge",
        "manual_only",
      ],
      diabetes_type: ["type_1", "type_2", "gestational", "other"],
      dispense_source: ["patient", "pharmacy"],
      doctor_tier: [
        "care_coordinator",
        "tier_1",
        "tier_2",
        "tier_3",
        "tier_4_senior_registrar",
        "tier_5_partner_specialist",
      ],
      ecg_report_document_source: [
        "patient",
        "lab_liaison",
        "clinician",
        "admin",
      ],
      emergency_event_status: ["active", "acknowledged", "resolved"],
      emergency_source: [
        "danger_symptom_checklist",
        "symptom_log",
        "ai_coach",
        "intake_screen",
        "bp_reading",
        "glucose_red_flag",
        "spo2_red_flag",
        "temperature_red_flag",
        "exposure_report",
      ],
      employer_roster_status: ["pending", "claimed", "removed"],
      escalation_status: ["open", "under_review", "resolved", "referred"],
      exposure_report_status: ["open", "completed", "withdrawn"],
      facility_type: [
        "hospital",
        "lab",
        "pharmacy",
        "radiology",
        "optician",
        "vaccination_centre",
      ],
      family_relationship: [
        "mother",
        "father",
        "sibling",
        "child",
        "maternal_grandmother",
        "maternal_grandfather",
        "paternal_grandmother",
        "paternal_grandfather",
        "aunt_or_uncle",
        "other",
      ],
      fhir_import_resource_status: [
        "proposed",
        "confirmed",
        "modified",
        "dismissed",
        "superseded",
      ],
      fhir_import_resource_type: [
        "Observation",
        "AllergyIntolerance",
        "MedicationStatement",
        "MedicationRequest",
        "Immunization",
      ],
      foot_risk_class: ["low", "increased", "high", "active"],
      foot_sensation: ["normal", "reduced", "absent"],
      fulfilment_mode: ["partner", "self_arranged"],
      glucose_context: [
        "fasting",
        "random",
        "post_meal",
        "pre_meal",
        "bedtime",
        "night",
      ],
      glycaemic_target_category: ["tight", "standard", "relaxed"],
      haemoglobin_genotype: ["AA", "AS", "AC", "SS", "SC", "CC", "other"],
      hbv_status: [
        "unknown",
        "hbv_negative",
        "chronic_hbv",
        "immune",
        "susceptible",
        "vaccinated_pending",
        "non_responder",
      ],
      hcv_status: [
        "unknown",
        "hcv_negative",
        "hcv_rna_pending",
        "hcv_active",
        "hcv_cleared",
      ],
      health_education_category: [
        "hypertension",
        "diabetes",
        "weight",
        "heart",
        "kidney",
        "respiratory",
        "cancer_screening",
        "womens_health",
        "mens_health",
        "mental_health",
        "nutrition",
        "medicines",
        "family_child",
        "getting_started",
      ],
      health_education_content_type: ["article", "video"],
      health_education_status: ["seen", "understood", "needs_review"],
      health_passport_attestation_status: [
        "pending",
        "attested",
        "declined",
        "withdrawn",
      ],
      health_passport_status: ["unsigned", "valid", "superseded", "revoked"],
      hiv_status: ["unknown", "hiv_negative", "hiv_positive"],
      hospital_admission_source: ["patient_reported", "staff_recorded"],
      identity_method: ["nin", "bvn", "document"],
      identity_verification_status: ["pending", "verified", "failed"],
      insulin_type: [
        "soluble",
        "nph",
        "premixed",
        "analogue_rapid",
        "analogue_long",
      ],
      lab_analyte_flag: [
        "normal",
        "low",
        "high",
        "critical_low",
        "critical_high",
      ],
      lab_monitoring_status: ["pending", "completed", "cancelled"],
      lab_order_status: [
        "pending_payment",
        "payment_confirmed",
        "ordered",
        "sample_collected",
        "processing",
        "resulted",
        "cancelled",
      ],
      lab_order_time_of_day: ["morning", "afternoon", "evening"],
      lab_order_transmission: [
        "not_required",
        "awaiting_payment",
        "queued",
        "sent",
        "acknowledged",
        "failed",
      ],
      lab_refund_reason: [
        "patient_cancelled",
        "never_attended",
        "sample_rejected",
        "partially_run",
        "result_lost",
        "duplicate_order",
        "clinically_withdrawn",
      ],
      lab_refund_status: ["requested", "approved", "rejected", "paid"],
      lab_result_document_source: [
        "patient",
        "lab_liaison",
        "clinician",
        "admin",
        "lab_partner",
      ],
      lead_role: ["patient", "family", "employer", "hmo", "other"],
      lpe_enrollment_status: [
        "draft",
        "active",
        "paused",
        "maintenance",
        "disengaged",
        "completed",
      ],
      lpe_goal_status: ["active", "achieved", "softened", "abandoned"],
      lpe_measurement_source: ["app", "web", "coordinator", "device"],
      lpe_measurement_type: [
        "bp",
        "glucose",
        "weight",
        "waist",
        "bmi_derived",
        "activity_minutes",
        "steps",
        "strength_session",
        "food_log",
        "mood",
        "sleep",
        "ketones",
        "insulin_dose",
        "med_adherence",
        "foot_check",
        "symptom",
        "side_effect",
      ],
      lpe_module: ["diet", "activity", "behaviour", "sleep", "stress"],
      lpe_phase_kind: [
        "foundation",
        "build",
        "strengthen",
        "maintenance",
        "continuous",
      ],
      lpe_phase_status: ["pending", "active", "completed"],
      lpe_red_flag_action: [
        "supportive_reply",
        "same_day_review",
        "auto_pause_weightloss",
        "page_oncall",
        "refer",
      ],
      lpe_red_flag_severity: ["amber", "red", "emergency"],
      lpe_red_flag_status: ["open", "stood_down"],
      lpe_task_channel: ["app", "whatsapp_reminder"],
      lpe_task_status: ["pending", "done", "missed", "skipped"],
      masked_call_context: [
        "care_coordination",
        "clinical_follow_up",
        "escalation_contact",
      ],
      masked_call_participant_role: ["patient", "staff"],
      masked_call_session_status: [
        "requested",
        "active",
        "closed",
        "expired",
        "failed",
      ],
      meal_type: ["breakfast", "lunch", "dinner", "snack"],
      med_adherence_alert_level: ["coach", "doctor"],
      med_adherence_alert_status: ["open", "acknowledged", "resolved"],
      medication_checkin_status: ["pending", "responded", "skipped"],
      medication_checkin_type: [
        "started",
        "side_effects",
        "missed_doses",
        "lab_review",
      ],
      medication_log_status: ["taken", "missed", "skipped"],
      medication_review_status: ["pending", "completed", "cancelled"],
      medication_source: ["clinician", "patient", "specialist", "fhir_import"],
      notification_channel: [
        "email",
        "sms",
        "in_app",
        "whatsapp",
        "push",
        "voice",
      ],
      notification_content_class: ["clinical", "non_clinical"],
      notification_priority: ["routine", "critical"],
      notification_status: ["pending", "sent", "delivered", "failed", "read"],
      obesity_bmi_category: [
        "underweight",
        "healthy",
        "overweight",
        "obesity_class_i",
        "obesity_class_ii",
        "obesity_class_iii",
      ],
      obesity_clinical_status: ["preclinical", "clinical"],
      obesity_waist_risk: ["normal", "raised", "high"],
      organisation_type: [
        "clinic",
        "hmo",
        "corporate",
        "lab",
        "pharmacy",
        "direct_consumer",
        "protocol_partner",
      ],
      outcomes_contract_type: ["fee_at_risk", "flat"],
      outreach_contact_channel: ["call", "whatsapp"],
      outreach_task_status: [
        "open",
        "in_progress",
        "contacted",
        "resolved",
        "dismissed",
      ],
      outreach_trigger_type: [
        "high_risk_score",
        "overdue_screening",
        "stale_monitoring",
        "unactioned_abnormal",
        "awaiting_result",
      ],
      partner_revenue_treatment: ["net_agent", "gross_principal"],
      partner_statement_line_resolution: [
        "unmatched",
        "agreed",
        "overcharged",
        "undercharged",
        "not_ordered",
        "not_delivered",
      ],
      partner_statement_status: [
        "draft",
        "matched",
        "disputed",
        "approved",
        "settled",
      ],
      patient_device_status: ["active", "unpaired"],
      patient_device_type: [
        "bp_cuff",
        "glucometer",
        "scale",
        "thermometer",
        "pulse_oximeter",
      ],
      payment_provider: ["paystack", "stripe", "wallet", "voucher"],
      payment_transaction_type: [
        "charge.success",
        "charge.failed",
        "subscription.create",
        "subscription.disable",
        "subscription.not_renew",
        "invoice.create",
        "invoice.update",
        "invoice.payment_failed",
        "other",
        "invoice.payment_succeeded",
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ],
      pharmacy_fulfilment_method: ["pickup", "delivery"],
      pharmacy_order_status: [
        "pending_payment",
        "payment_confirmed",
        "requested",
        "confirmed",
        "dispensed",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      prevention_condition: [
        "hypertension",
        "diabetes",
        "cvd",
        "breast_ca",
        "cervical_ca",
        "colorectal_ca",
        "prostate_ca",
        "other",
        "ckd",
        "asthma_copd",
        "mental_wellbeing",
      ],
      prevention_campaign_action_type: [
        "education",
        "screening_invite",
        "assessment",
        "discount",
        "challenge",
      ],
      prevention_campaign_enrolment_status: ["invited", "joined", "completed", "declined"],
      prevention_campaign_status: ["draft", "active", "ended"],
      preventive_enrolment_source: ["recommended", "self", "staff"],
      preventive_enrolment_status: ["enrolled", "completed", "withdrawn"],
      profile_access_level: ["view", "manage"],
      reassessment_reason: [
        "new_diagnosis",
        "abnormal_result",
        "hospital_discharge",
        "pregnancy_life_stage",
        "major_weight_change",
      ],
      referral_reward_status: ["pending", "earned", "paid"],
      referral_status: [
        "pending_payment",
        "payment_confirmed",
        "pending",
        "waitlisted",
        "booked",
        "confirmed",
        "completed",
        "declined",
      ],
      referral_type: [
        "patient_refers_patient",
        "doctor_refers_patient",
        "corporate_champion",
      ],
      referral_urgency: ["routine", "priority", "urgent"],
      reminder_stage: ["upcoming", "due", "overdue", "escalated"],
      reproductive_life_stage: [
        "menstruating",
        "trying_to_conceive",
        "pregnant",
        "postpartum",
        "perimenopausal",
        "menopausal",
        "not_applicable",
      ],
      result_status: ["normal", "borderline", "abnormal", "critical"],
      risk_assessment_category: [
        "lifestyle",
        "family_history",
        "pmh",
        "meds",
        "vaccination",
        "screening_history",
      ],
      risk_confidence: ["low", "moderate", "high"],
      risk_level: ["low", "moderate", "high", "very_high", "unknown"],
      screen_applicability: ["all", "male", "female"],
      screen_price_source: [
        "lab_price_list",
        "provisional",
        "contracted",
        "derived_from_panel_total",
      ],
      screening_status: [
        "pending",
        "booked",
        "completed",
        "overdue",
        "cancelled",
      ],
      sex: ["male", "female"],
      specialist_type: [
        "urologist",
        "oncologist",
        "ob_gyn",
        "cardiology",
        "endocrinology",
        "nephrology",
        "ophthalmology",
        "dietetics",
        "podiatry",
        "other",
      ],
      subscription_status: ["trialing", "active", "past_due", "cancelled"],
      symptom_type: [
        "pain",
        "fatigue",
        "breathlessness",
        "dizziness",
        "palpitations",
        "swelling",
        "nausea",
        "other",
        "chest_pain",
        "severe_headache",
        "visual_disturbance",
        "confusion",
      ],
      timeline_event_type: [
        "lab_completed",
        "lab_abnormal",
        "medication_started",
        "medication_stopped",
        "medication_missed",
        "referral_created",
        "referral_status_changed",
        "screening_due",
        "screening_completed",
        "vaccination_recorded",
        "escalation_raised",
        "escalation_resolved",
        "care_plan_updated",
        "admission_recorded",
        "discharge_recorded",
        "message_posted",
        "medication_dispensed",
        "encounter_documented",
        "condition_recorded",
        "condition_status_changed",
        "medication_received",
      ],
      upgrade_condition: [
        "hypertension",
        "diabetes",
        "cancer_referral",
        "other",
      ],
      user_role: [
        "patient",
        "clinician",
        "admin",
        "hmo_admin",
        "corporate_admin",
        "care_coordinator",
        "pharmacist",
        "analyst",
        "lab_liaison",
        "finance",
        "lab_partner",
      ],
      vaccination_verification_status: [
        "self_reported",
        "pending_verification",
        "verified",
        "rejected",
      ],
      video_consultation_context: [
        "pre_referral_triage",
        "specialist_consult",
        "annual_review",
        "general_checkin",
      ],
      video_consultation_status: [
        "scheduled",
        "started",
        "completed",
        "cancelled",
        "no_show",
      ],
      video_visit_request_status: [
        "requested",
        "pending_payment",
        "payment_confirmed",
        "accepted",
        "declined",
        "expired",
        "cancelled",
        "refunded",
        "alternate_proposed",
      ],
      vital_source: ["manual", "device", "wearable", "cgm", "fhir_import"],
      vital_type: [
        "blood_pressure",
        "glucose",
        "weight",
        "pulse",
        "temperature",
        "spo2",
        "waist_circumference",
        "ketones",
        "respiratory_rate",
        "peak_flow",
      ],
      wearable_connection_status: ["active", "disconnected", "error"],
      wearable_provider: [
        "apple_health",
        "oura",
        "whoop",
        "garmin",
        "fitbit",
        "dexcom",
        "libre",
        "android_health_connect",
      ],
      wellness_challenge_metric: [
        "vitals_logs",
        "meal_logs",
        "adherence_checkins",
        "lpe_tasks",
        "education_lessons",
      ],
      wellness_challenge_status: ["active", "completed", "expired"],
      wellness_class_registration_status: [
        "registered",
        "attended",
        "no_show",
        "cancelled",
      ],
      wellness_class_type: ["virtual", "in_person"],
    },
  },
} as const
