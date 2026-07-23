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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      add_ons: {
        Row: {
          code: string
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
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
        Relationships: []
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
          notes: string | null
          organisation_id: string
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
          notes?: string | null
          organisation_id: string
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
          notes?: string | null
          organisation_id?: string
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
            foreignKeyName: "care_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      clinical_staff: {
        Row: {
          active: boolean
          bio: string | null
          created_at: string
          credential_number: string | null
          credential_type: string | null
          doctor_tier: Database["public"]["Enums"]["doctor_tier"] | null
          full_name: string
          id: string
          indemnity_exempt: boolean
          indemnity_exempt_by: string | null
          indemnity_expires_at: string | null
          indemnity_insurer: string | null
          indemnity_policy_number: string | null
          is_clinical_director: boolean
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
          doctor_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          full_name: string
          id?: string
          indemnity_exempt?: boolean
          indemnity_exempt_by?: string | null
          indemnity_expires_at?: string | null
          indemnity_insurer?: string | null
          indemnity_policy_number?: string | null
          is_clinical_director?: boolean
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
          doctor_tier?: Database["public"]["Enums"]["doctor_tier"] | null
          full_name?: string
          id?: string
          indemnity_exempt?: boolean
          indemnity_exempt_by?: string | null
          indemnity_expires_at?: string | null
          indemnity_insurer?: string | null
          indemnity_policy_number?: string | null
          is_clinical_director?: boolean
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
          patient_id: string
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
          patient_id: string
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
          patient_id?: string
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
          organisation_id: string
          patient_id: string
          source: Database["public"]["Enums"]["emergency_source"]
          status: Database["public"]["Enums"]["emergency_event_status"]
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
          organisation_id: string
          patient_id: string
          source: Database["public"]["Enums"]["emergency_source"]
          status?: Database["public"]["Enums"]["emergency_event_status"]
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
          organisation_id?: string
          patient_id?: string
          source?: Database["public"]["Enums"]["emergency_source"]
          status?: Database["public"]["Enums"]["emergency_event_status"]
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
      family_plan_members: {
        Row: {
          conditions: string[]
          created_at: string
          id: string
          member_id: string
          onboarded_at: string
          organisation_id: string
          plan_id: string | null
          plan_owner_id: string
          relationship: Database["public"]["Enums"]["family_relationship"]
        }
        Insert: {
          conditions?: string[]
          created_at?: string
          id?: string
          member_id: string
          onboarded_at?: string
          organisation_id: string
          plan_id?: string | null
          plan_owner_id: string
          relationship?: Database["public"]["Enums"]["family_relationship"]
        }
        Update: {
          conditions?: string[]
          created_at?: string
          id?: string
          member_id?: string
          onboarded_at?: string
          organisation_id?: string
          plan_id?: string | null
          plan_owner_id?: string
          relationship?: Database["public"]["Enums"]["family_relationship"]
        }
        Relationships: [
          {
            foreignKeyName: "family_plan_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_plan_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_plan_members_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_plan_members_plan_owner_id_fkey"
            columns: ["plan_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      health_education_content: {
        Row: {
          body: string
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
      hmo_contracts: {
        Row: {
          capitation_rate_kobo: number
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          latest_claim: Json
          member_count: number
          name: string
          organisation_id: string
          status: Database["public"]["Enums"]["contract_status"]
          updated_at: string
        }
        Insert: {
          capitation_rate_kobo?: number
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          latest_claim?: Json
          member_count?: number
          name: string
          organisation_id: string
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Update: {
          capitation_rate_kobo?: number
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          latest_claim?: Json
          member_count?: number
          name?: string
          organisation_id?: string
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hmo_contracts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      home_visit_providers: {
        Row: {
          created_at: string
          home_visit_fee_kobo: number
          id: string
          is_active: boolean
          name: string
          regions: string[]
          sample_types: string[]
        }
        Insert: {
          created_at?: string
          home_visit_fee_kobo?: number
          id?: string
          is_active?: boolean
          name: string
          regions?: string[]
          sample_types?: string[]
        }
        Update: {
          created_at?: string
          home_visit_fee_kobo?: number
          id?: string
          is_active?: boolean
          name?: string
          regions?: string[]
          sample_types?: string[]
        }
        Relationships: []
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
          code: string
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          taken_at: string
          unit: string
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          taken_at?: string
          unit: string
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          taken_at?: string
          unit?: string
          value?: number
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
      lab_orders: {
        Row: {
          courier_reference: string | null
          created_at: string
          facility_id: string | null
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
          patient_id: string
          payment_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref: string | null
          pending_payment_provider_ref: string | null
          provider_id: string | null
          resulted_at: string | null
          screening_schedule_id: string | null
          status: Database["public"]["Enums"]["lab_order_status"]
          total_kobo: number
          updated_at: string
        }
        Insert: {
          courier_reference?: string | null
          created_at?: string
          facility_id?: string | null
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
          patient_id: string
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          provider_id?: string | null
          resulted_at?: string | null
          screening_schedule_id?: string | null
          status?: Database["public"]["Enums"]["lab_order_status"]
          total_kobo?: number
          updated_at?: string
        }
        Update: {
          courier_reference?: string | null
          created_at?: string
          facility_id?: string | null
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
          patient_id?: string
          payment_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          payment_provider_ref?: string | null
          pending_payment_provider_ref?: string | null
          provider_id?: string | null
          resulted_at?: string | null
          screening_schedule_id?: string | null
          status?: Database["public"]["Enums"]["lab_order_status"]
          total_kobo?: number
          updated_at?: string
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
      lab_providers: {
        Row: {
          created_at: string
          home_collection: boolean
          id: string
          is_active: boolean
          name: string
          regions: string[]
        }
        Insert: {
          created_at?: string
          home_collection?: boolean
          id?: string
          is_active?: boolean
          name: string
          regions?: string[]
        }
        Update: {
          created_at?: string
          home_collection?: boolean
          id?: string
          is_active?: boolean
          name?: string
          regions?: string[]
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
          lab_order_id: string | null
          mime_type: string | null
          note: string | null
          organisation_id: string
          original_filename: string | null
          patient_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
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
          lab_order_id?: string | null
          mime_type?: string | null
          note?: string | null
          organisation_id: string
          original_filename?: string | null
          patient_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          lab_order_id?: string | null
          mime_type?: string | null
          note?: string | null
          organisation_id?: string
          original_filename?: string | null
          patient_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          created_at: string
          id: string
          message: string | null
          name: string
          role: Database["public"]["Enums"]["lead_role"]
          source: string
        }
        Insert: {
          contact: string
          created_at?: string
          id?: string
          message?: string | null
          name: string
          role: Database["public"]["Enums"]["lead_role"]
          source?: string
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          message?: string | null
          name?: string
          role?: Database["public"]["Enums"]["lead_role"]
          source?: string
        }
        Relationships: []
      }
      logistics_partners: {
        Row: {
          created_at: string
          delivery_fee_kobo: number
          estimated_delivery_hours: number | null
          id: string
          is_active: boolean
          name: string
          regions: string[]
        }
        Insert: {
          created_at?: string
          delivery_fee_kobo?: number
          estimated_delivery_hours?: number | null
          id?: string
          is_active?: boolean
          name: string
          regions?: string[]
        }
        Update: {
          created_at?: string
          delivery_fee_kobo?: number
          estimated_delivery_hours?: number | null
          id?: string
          is_active?: boolean
          name?: string
          regions?: string[]
        }
        Relationships: []
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
      notifications: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          last_error: string | null
          organisation_id: string | null
          payload: Json
          recipient_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          template: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          last_error?: string | null
          organisation_id?: string | null
          payload?: Json
          recipient_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          last_error?: string | null
          organisation_id?: string | null
          payload?: Json
          recipient_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template?: string | null
          updated_at?: string
        }
        Relationships: [
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
          name: string
          type: Database["public"]["Enums"]["organisation_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          name: string
          type: Database["public"]["Enums"]["organisation_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
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
          name: string
          price_kobo: number
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
          name: string
          price_kobo?: number
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
          name?: string
          price_kobo?: number
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
      patient_glucose_targets: {
        Row: {
          category: Database["public"]["Enums"]["glycaemic_target_category"]
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
          organisation_id: string
          patient_id: string
          pharmacy_order_id: string
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
          organisation_id: string
          patient_id: string
          pharmacy_order_id: string
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
          organisation_id?: string
          patient_id?: string
          pharmacy_order_id?: string
          quantity?: string | null
          recorded_by?: string | null
          source?: Database["public"]["Enums"]["dispense_source"]
          updated_at?: string
        }
        Relationships: [
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
        }
        Insert: {
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
        }
        Update: {
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
          longitude?: number | null
          name?: string
          regions?: string[]
          state?: string | null
          uses_platform_login?: boolean
        }
        Relationships: []
      }
      platform_currency_settings: {
        Row: {
          id: boolean
          updated_at: string
          updated_by: string | null
          usd_per_gbp: number
        }
        Insert: {
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          usd_per_gbp?: number
        }
        Update: {
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          usd_per_gbp?: number
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
      prevention_risk_scores: {
        Row: {
          computed_at: string
          condition: Database["public"]["Enums"]["prevention_condition"]
          created_at: string
          id: string
          inputs_snapshot: Json
          organisation_id: string
          profile_id: string
          tier: Database["public"]["Enums"]["risk_level"]
        }
        Insert: {
          computed_at?: string
          condition: Database["public"]["Enums"]["prevention_condition"]
          created_at?: string
          id?: string
          inputs_snapshot?: Json
          organisation_id: string
          profile_id: string
          tier?: Database["public"]["Enums"]["risk_level"]
        }
        Update: {
          computed_at?: string
          condition?: Database["public"]["Enums"]["prevention_condition"]
          created_at?: string
          id?: string
          inputs_snapshot?: Json
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
          created_at: string
          granted_by: string
          grantee_user_id: string
          id: string
          permission_level: Database["public"]["Enums"]["profile_access_level"]
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          grantee_user_id: string
          id?: string
          permission_level?: Database["public"]["Enums"]["profile_access_level"]
          profile_id: string
          updated_at?: string
        }
        Update: {
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
          area: string | null
          city: string | null
          created_at: string
          custom_role_id: string | null
          date_of_birth: string | null
          emergency_contact_consent: boolean
          emergency_contact_consent_at: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          full_name: string | null
          id: string
          identity_verified_at: string | null
          is_active: boolean
          is_pregnant: boolean
          metadata: Json
          next_of_kin_name: string | null
          next_of_kin_phone: string | null
          onboarding_completed_at: string | null
          organisation_id: string | null
          patient_number: string | null
          pharmacy_partner_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          sex: Database["public"]["Enums"]["sex"] | null
          state: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          city?: string | null
          created_at?: string
          custom_role_id?: string | null
          date_of_birth?: string | null
          emergency_contact_consent?: boolean
          emergency_contact_consent_at?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          full_name?: string | null
          id: string
          identity_verified_at?: string | null
          is_active?: boolean
          is_pregnant?: boolean
          metadata?: Json
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          onboarding_completed_at?: string | null
          organisation_id?: string | null
          patient_number?: string | null
          pharmacy_partner_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          city?: string | null
          created_at?: string
          custom_role_id?: string | null
          date_of_birth?: string | null
          emergency_contact_consent?: boolean
          emergency_contact_consent_at?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          full_name?: string | null
          id?: string
          identity_verified_at?: string | null
          is_active?: boolean
          is_pregnant?: boolean
          metadata?: Json
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          onboarding_completed_at?: string | null
          organisation_id?: string | null
          patient_number?: string | null
          pharmacy_partner_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
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
      risk_assessment_responses: {
        Row: {
          category: Database["public"]["Enums"]["risk_assessment_category"]
          created_at: string
          id: string
          organisation_id: string
          profile_id: string
          question_key: string
          response: Json
        }
        Insert: {
          category: Database["public"]["Enums"]["risk_assessment_category"]
          created_at?: string
          id?: string
          organisation_id: string
          profile_id: string
          question_key: string
          response?: Json
        }
        Update: {
          category?: Database["public"]["Enums"]["risk_assessment_category"]
          created_at?: string
          id?: string
          organisation_id?: string
          profile_id?: string
          question_key?: string
          response?: Json
        }
        Relationships: [
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
          code: string
          commission_rate: number | null
          created_at: string
          frequency_months: number | null
          id: string
          is_active: boolean
          name: string
          recommended_provider_type:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          sensitive: boolean
          sex_applicability: Database["public"]["Enums"]["screen_applicability"]
        }
        Insert: {
          age_from?: number | null
          age_to?: number | null
          code: string
          commission_rate?: number | null
          created_at?: string
          frequency_months?: number | null
          id?: string
          is_active?: boolean
          name: string
          recommended_provider_type?:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          sensitive?: boolean
          sex_applicability?: Database["public"]["Enums"]["screen_applicability"]
        }
        Update: {
          age_from?: number | null
          age_to?: number | null
          code?: string
          commission_rate?: number | null
          created_at?: string
          frequency_months?: number | null
          id?: string
          is_active?: boolean
          name?: string
          recommended_provider_type?:
            | Database["public"]["Enums"]["organisation_type"]
            | null
          sensitive?: boolean
          sex_applicability?: Database["public"]["Enums"]["screen_applicability"]
        }
        Relationships: []
      }
      screening_results: {
        Row: {
          abnormal_flags: string[]
          created_at: string
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
          location?: string | null
          name?: string
          specialist_type?: Database["public"]["Enums"]["specialist_type"]
          state?: string | null
          supports_in_person?: boolean
          supports_telemedicine?: boolean
        }
        Relationships: []
      }
      specialist_referrals: {
        Row: {
          appointment_date: string | null
          booking_confirmed_at: string | null
          clinical_summary: Json | null
          created_at: string
          id: string
          interim_management_plan: string | null
          organisation_id: string
          origin: Database["public"]["Enums"]["booking_origin"]
          patient_id: string
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
          waitlisted_at: string | null
        }
        Insert: {
          appointment_date?: string | null
          booking_confirmed_at?: string | null
          clinical_summary?: Json | null
          created_at?: string
          id?: string
          interim_management_plan?: string | null
          organisation_id: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          patient_id: string
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
          waitlisted_at?: string | null
        }
        Update: {
          appointment_date?: string | null
          booking_confirmed_at?: string | null
          clinical_summary?: Json | null
          created_at?: string
          id?: string
          interim_management_plan?: string | null
          organisation_id?: string
          origin?: Database["public"]["Enums"]["booking_origin"]
          patient_id?: string
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
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_minor: number
          cancelled_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency"]
          current_period_end: string | null
          id: string
          interval: Database["public"]["Enums"]["billing_interval"]
          organisation_id: string
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
          cancelled_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          current_period_end?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          organisation_id: string
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
          cancelled_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency"]
          current_period_end?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          organisation_id?: string
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
          organisation_id?: string
          patient_id?: string
          reported_at?: string
          severity?: number | null
          symptom_type?: Database["public"]["Enums"]["symptom_type"]
        }
        Relationships: [
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
      vaccination_schedules: {
        Row: {
          created_at: string
          due_date: string
          id: string
          organisation_id: string
          patient_id: string
          reminder_sent_at: string | null
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
          note: string | null
          organisation_id: string
          patient_id: string
          pulse_bpm: number | null
          source: Database["public"]["Enums"]["vital_source"]
          spo2_pct: number | null
          systolic: number | null
          taken_at: string
          temperature_c: number | null
          vital_type: Database["public"]["Enums"]["vital_type"]
          waist_cm: number | null
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
          note?: string | null
          organisation_id: string
          patient_id: string
          pulse_bpm?: number | null
          source?: Database["public"]["Enums"]["vital_source"]
          spo2_pct?: number | null
          systolic?: number | null
          taken_at?: string
          temperature_c?: number | null
          vital_type: Database["public"]["Enums"]["vital_type"]
          waist_cm?: number | null
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
          note?: string | null
          organisation_id?: string
          patient_id?: string
          pulse_bpm?: number | null
          source?: Database["public"]["Enums"]["vital_source"]
          spo2_pct?: number | null
          systolic?: number | null
          taken_at?: string
          temperature_c?: number | null
          vital_type?: Database["public"]["Enums"]["vital_type"]
          waist_cm?: number | null
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
          connected_at: string
          created_at: string
          external_id: string | null
          id: string
          last_synced_at: string | null
          organisation_id: string
          patient_id: string
          provider: Database["public"]["Enums"]["wearable_provider"]
          status: Database["public"]["Enums"]["wearable_connection_status"]
        }
        Insert: {
          connected_at?: string
          created_at?: string
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          organisation_id: string
          patient_id: string
          provider: Database["public"]["Enums"]["wearable_provider"]
          status?: Database["public"]["Enums"]["wearable_connection_status"]
        }
        Update: {
          connected_at?: string
          created_at?: string
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          organisation_id?: string
          patient_id?: string
          provider?: Database["public"]["Enums"]["wearable_provider"]
          status?: Database["public"]["Enums"]["wearable_connection_status"]
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
          diabetic_patients: number | null
          foot_uptodate: number | null
          organisation_id: string | null
          renal_uptodate: number | null
          retinal_uptodate: number | null
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
      admin_broadcast_audience_count: {
        Args: {
          p_audience: Database["public"]["Enums"]["broadcast_audience"]
          p_filter: Json
        }
        Returns: number
      }
      admin_member_activity: { Args: { p_member: string }; Returns: Json }
      admin_send_broadcast: {
        Args: { p_broadcast_id: string }
        Returns: number
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
        Args: { p_patient_id: string; p_reason: string | null }
        Returns: undefined
      }
      analytics_operations_summary: { Args: never; Returns: Json }
      analytics_patient_activity: {
        Args: { p_patient_id: string }
        Returns: Json
      }
      analytics_patient_search: { Args: { p_query: string }; Returns: Json }
      analytics_population_summary: { Args: never; Returns: Json }
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
          p_new_customers: number | null
          p_notes: string | null
          p_opex: number
        }
        Returns: undefined
      }
      analytics_upsert_risk: {
        Args: {
          p_category: string
          p_id: string | null
          p_impact: string
          p_likelihood: string
          p_mitigation: string | null
          p_owner: string | null
          p_status: string
          p_title: string
        }
        Returns: string
      }
      analytics_user_segments: { Args: never; Returns: Json }
      bp_secondary_flags: { Args: { p_patient: string }; Returns: Json }
      claim_employer_roster_member: {
        Args: { target_roster_id: string }
        Returns: boolean
      }
      decline_video_visit_request: {
        Args: { p_reason: string; p_request_id: string }
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
      has_ai_coach_access: { Args: never; Returns: boolean }
      has_feature_access: { Args: { feature: string }; Returns: boolean }
      hbpm_summary: { Args: { p_patient: string }; Returns: Json }
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
      health_education_locked_count: { Args: never; Returns: number }
      htn_quality_metrics: { Args: { p_org: string }; Returns: Json }
      open_health_check: { Args: never; Returns: string }
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
      pharmacist_record_dispense: {
        Args: {
          p_dispensed_on: string
          p_drug_name: string
          p_order_id: string
          p_quantity: string
        }
        Returns: undefined
      }
      post_care_message: {
        Args: { p_body: string; p_thread_id: string }
        Returns: string
      }
      region_service_available: {
        Args: { p_service: string; p_state: string }
        Returns: boolean
      }
      set_pharmacy_order_delivery_address: {
        Args: { p_address: Json; p_order_id: string }
        Returns: boolean
      }
      sign_cv_risk_config: { Args: { p_config_id: string }; Returns: string }
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
    }
    Enums: {
      alert_level:
        | "routine"
        | "clinician_review"
        | "urgent_escalation"
        | "emergency"
      alert_status: "open" | "acknowledged" | "resolved"
      allergy_severity: "mild" | "moderate" | "severe"
      allergy_source: "patient" | "clinician"
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
      booking_origin: "patient_initiated" | "clinically_triggered" | "capitated"
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
      care_message_author: "patient" | "care_team"
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
      chronic_enrolment_source: "recommended" | "staff" | "clinician"
      chronic_enrolment_status: "enrolled" | "completed" | "withdrawn"
      commission_rate_type: "percentage" | "flat"
      commission_status: "pending" | "confirmed" | "paid"
      commission_type:
        | "lab"
        | "pharmacy"
        | "referral"
        | "home_visit"
        | "delivery"
      complication_check_type: "retinal" | "renal"
      consent_type: "data_processing" | "telehealth" | "terms_of_service"
      contract_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "paid"
        | "active"
      currency: "NGN" | "GBP" | "USD"
      dispense_source: "patient" | "pharmacy"
      doctor_tier:
        | "care_coordinator"
        | "tier_1"
        | "tier_2"
        | "tier_3"
        | "tier_4_senior_registrar"
        | "tier_5_partner_specialist"
      emergency_event_status: "active" | "acknowledged" | "resolved"
      emergency_source:
        | "danger_symptom_checklist"
        | "symptom_log"
        | "ai_coach"
        | "intake_screen"
        | "glucose_red_flag"
        | "bp_reading"
      employer_roster_status: "pending" | "claimed" | "removed"
      escalation_status: "open" | "under_review" | "resolved" | "referred"
      facility_type:
        | "hospital"
        | "lab"
        | "pharmacy"
        | "radiology"
        | "optician"
        | "vaccination_centre"
      family_relationship: "spouse" | "parent" | "child" | "sibling" | "other"
      foot_risk_class: "low" | "increased" | "high" | "active"
      foot_sensation: "normal" | "reduced" | "absent"
      glucose_context:
        | "fasting"
        | "random"
        | "post_meal"
        | "pre_meal"
        | "bedtime"
        | "night"
      glycaemic_target_category: "tight" | "standard" | "relaxed"
      health_education_content_type: "article" | "video"
      health_education_status: "seen" | "understood" | "needs_review"
      hospital_admission_source: "patient_reported" | "staff_recorded"
      identity_method: "nin" | "bvn" | "document"
      identity_verification_status: "pending" | "verified" | "failed"
      insulin_type:
        | "soluble"
        | "nph"
        | "premixed"
        | "analogue_rapid"
        | "analogue_long"
      lab_monitoring_status: "pending" | "completed" | "cancelled"
      lab_order_status:
        | "pending_payment"
        | "payment_confirmed"
        | "ordered"
        | "sample_collected"
        | "processing"
        | "resulted"
        | "cancelled"
      lab_result_document_source:
        | "patient"
        | "lab_liaison"
        | "clinician"
        | "admin"
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
      medication_source: "clinician" | "patient" | "specialist"
      notification_channel: "email" | "sms" | "in_app" | "whatsapp" | "push"
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
      outcomes_contract_type: "capitation" | "fee_at_risk" | "flat"
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
      patient_device_status: "active" | "unpaired"
      patient_device_type:
        | "bp_cuff"
        | "glucometer"
        | "scale"
        | "thermometer"
        | "pulse_oximeter"
      payment_provider: "paystack" | "stripe"
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
      preventive_enrolment_source: "recommended" | "self" | "staff"
      preventive_enrolment_status: "enrolled" | "completed" | "withdrawn"
      profile_access_level: "view" | "manage"
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
      result_status: "normal" | "borderline" | "abnormal" | "critical"
      risk_assessment_category:
        | "lifestyle"
        | "family_history"
        | "pmh"
        | "meds"
        | "vaccination"
        | "screening_history"
      risk_level: "low" | "moderate" | "high" | "very_high"
      screen_applicability: "all" | "male" | "female"
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
        | "doctor"
        | "care_coordinator"
        | "pharmacist"
        | "analyst"
        | "lab_liaison"
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
      vital_source: "manual" | "device" | "wearable" | "cgm"
      vital_type:
        | "blood_pressure"
        | "glucose"
        | "weight"
        | "pulse"
        | "temperature"
        | "spo2"
        | "waist_circumference"
        | "ketones"
      wearable_connection_status: "active" | "disconnected" | "error"
      wearable_provider: "apple_health" | "oura" | "whoop" | "garmin" | "fitbit"
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
      alert_level: [
        "routine",
        "clinician_review",
        "urgent_escalation",
        "emergency",
      ],
      alert_status: ["open", "acknowledged", "resolved"],
      allergy_severity: ["mild", "moderate", "severe"],
      allergy_source: ["patient", "clinician"],
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
      booking_origin: [
        "patient_initiated",
        "clinically_triggered",
        "capitated",
      ],
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
      care_message_author: ["patient", "care_team"],
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
      chronic_enrolment_source: ["recommended", "staff", "clinician"],
      chronic_enrolment_status: ["enrolled", "completed", "withdrawn"],
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
      dispense_source: ["patient", "pharmacy"],
      doctor_tier: [
        "care_coordinator",
        "tier_1",
        "tier_2",
        "tier_3",
        "tier_4_senior_registrar",
        "tier_5_partner_specialist",
      ],
      emergency_event_status: ["active", "acknowledged", "resolved"],
      emergency_source: [
        "danger_symptom_checklist",
        "symptom_log",
        "ai_coach",
        "intake_screen",
        "glucose_red_flag",
        "bp_reading",
      ],
      employer_roster_status: ["pending", "claimed", "removed"],
      escalation_status: ["open", "under_review", "resolved", "referred"],
      facility_type: [
        "hospital",
        "lab",
        "pharmacy",
        "radiology",
        "optician",
        "vaccination_centre",
      ],
      family_relationship: ["spouse", "parent", "child", "sibling", "other"],
      foot_risk_class: ["low", "increased", "high", "active"],
      foot_sensation: ["normal", "reduced", "absent"],
      glucose_context: [
        "fasting",
        "random",
        "post_meal",
        "pre_meal",
        "bedtime",
        "night",
      ],
      glycaemic_target_category: ["tight", "standard", "relaxed"],
      health_education_content_type: ["article", "video"],
      health_education_status: ["seen", "understood", "needs_review"],
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
      lab_result_document_source: [
        "patient",
        "lab_liaison",
        "clinician",
        "admin",
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
      medication_source: ["clinician", "patient", "specialist"],
      notification_channel: ["email", "sms", "in_app", "whatsapp", "push"],
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
      ],
      outcomes_contract_type: ["capitation", "fee_at_risk", "flat"],
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
      ],
      patient_device_status: ["active", "unpaired"],
      patient_device_type: [
        "bp_cuff",
        "glucometer",
        "scale",
        "thermometer",
        "pulse_oximeter",
      ],
      payment_provider: ["paystack", "stripe"],
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
      ],
      preventive_enrolment_source: ["recommended", "self", "staff"],
      preventive_enrolment_status: ["enrolled", "completed", "withdrawn"],
      profile_access_level: ["view", "manage"],
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
      result_status: ["normal", "borderline", "abnormal", "critical"],
      risk_assessment_category: [
        "lifestyle",
        "family_history",
        "pmh",
        "meds",
        "vaccination",
        "screening_history",
      ],
      risk_level: ["low", "moderate", "high", "very_high"],
      screen_applicability: ["all", "male", "female"],
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
        "doctor",
        "care_coordinator",
        "pharmacist",
        "analyst",
        "lab_liaison",
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
      ],
      vital_source: ["manual", "device", "wearable", "cgm"],
      vital_type: [
        "blood_pressure",
        "glucose",
        "weight",
        "pulse",
        "temperature",
        "spo2",
        "waist_circumference",
        "ketones",
      ],
      wearable_connection_status: ["active", "disconnected", "error"],
      wearable_provider: ["apple_health", "oura", "whoop", "garmin", "fitbit"],
    },
  },
} as const
