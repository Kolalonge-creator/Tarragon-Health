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
      clinician_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          detail: string | null
          id: string
          level: Database["public"]["Enums"]["alert_level"]
          organisation_id: string
          patient_id: string
          sla_due_at: string | null
          status: Database["public"]["Enums"]["alert_status"]
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          level?: Database["public"]["Enums"]["alert_level"]
          organisation_id: string
          patient_id: string
          sla_due_at?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          level?: Database["public"]["Enums"]["alert_level"]
          organisation_id?: string
          patient_id?: string
          sla_due_at?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurse_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurse_alerts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurse_alerts_patient_id_fkey"
            columns: ["patient_id"]
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
          source_id: string | null
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
          source_id?: string | null
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
          source_id?: string | null
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
      escalations: {
        Row: {
          assigned_clinician_id: string | null
          clinician_alert_id: string | null
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          raised_by: string | null
          reason: string
          resolution_note: string | null
          status: Database["public"]["Enums"]["escalation_status"]
          updated_at: string
        }
        Insert: {
          assigned_clinician_id?: string | null
          clinician_alert_id?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          raised_by?: string | null
          reason: string
          resolution_note?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Update: {
          assigned_clinician_id?: string | null
          clinician_alert_id?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          raised_by?: string | null
          reason?: string
          resolution_note?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalations_assigned_clinician_id_fkey"
            columns: ["assigned_clinician_id"]
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
        ]
      }
      facilities: {
        Row: {
          address: string | null
          city: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          state: string
          type: Database["public"]["Enums"]["facility_type"]
        }
        Insert: {
          address?: string | null
          city: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          state: string
          type: Database["public"]["Enums"]["facility_type"]
        }
        Update: {
          address?: string | null
          city?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          state?: string
          type?: Database["public"]["Enums"]["facility_type"]
        }
        Relationships: []
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
      lab_orders: {
        Row: {
          created_at: string
          id: string
          ordered_at: string
          organisation_id: string
          panel_bundle_id: string | null
          patient_id: string
          provider_id: string | null
          resulted_at: string | null
          screening_schedule_id: string | null
          status: Database["public"]["Enums"]["lab_order_status"]
          total_kobo: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ordered_at?: string
          organisation_id: string
          panel_bundle_id?: string | null
          patient_id: string
          provider_id?: string | null
          resulted_at?: string | null
          screening_schedule_id?: string | null
          status?: Database["public"]["Enums"]["lab_order_status"]
          total_kobo?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ordered_at?: string
          organisation_id?: string
          panel_bundle_id?: string | null
          patient_id?: string
          provider_id?: string | null
          resulted_at?: string | null
          screening_schedule_id?: string | null
          status?: Database["public"]["Enums"]["lab_order_status"]
          total_kobo?: number
          updated_at?: string
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
          commission_rate: number | null
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
          commission_rate?: number | null
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
          commission_rate?: number | null
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
          organisation_id: string
          patient_id: string
          refill_date: string | null
          schedule_times: Json
          source: Database["public"]["Enums"]["medication_source"]
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
          organisation_id: string
          patient_id: string
          refill_date?: string | null
          schedule_times?: Json
          source?: Database["public"]["Enums"]["medication_source"]
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
          organisation_id?: string
          patient_id?: string
          refill_date?: string | null
          schedule_times?: Json
          source?: Database["public"]["Enums"]["medication_source"]
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
      panel_bundles: {
        Row: {
          code: string
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
      pharmacy_medications: {
        Row: {
          created_at: string
          drug_name: string
          id: string
          is_active: boolean
          pack_size: string | null
          pharmacy_partner_id: string
          price_kobo: number
        }
        Insert: {
          created_at?: string
          drug_name: string
          id?: string
          is_active?: boolean
          pack_size?: string | null
          pharmacy_partner_id: string
          price_kobo?: number
        }
        Update: {
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
      pharmacy_orders: {
        Row: {
          created_at: string
          delivered_at: string | null
          id: string
          items: Json
          organisation_id: string
          patient_id: string
          pharmacy_partner_id: string | null
          requested_at: string
          status: Database["public"]["Enums"]["pharmacy_order_status"]
          total_kobo: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          id?: string
          items?: Json
          organisation_id: string
          patient_id: string
          pharmacy_partner_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["pharmacy_order_status"]
          total_kobo?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          id?: string
          items?: Json
          organisation_id?: string
          patient_id?: string
          pharmacy_partner_id?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["pharmacy_order_status"]
          total_kobo?: number
          updated_at?: string
        }
        Relationships: [
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
          created_at: string
          delivery: boolean
          id: string
          is_active: boolean
          name: string
          regions: string[]
        }
        Insert: {
          created_at?: string
          delivery?: boolean
          id?: string
          is_active?: boolean
          name: string
          regions?: string[]
        }
        Update: {
          created_at?: string
          delivery?: boolean
          id?: string
          is_active?: boolean
          name?: string
          regions?: string[]
        }
        Relationships: []
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
          created_at: string
          date_of_birth: string | null
          full_name: string | null
          id: string
          is_active: boolean
          metadata: Json
          organisation_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          sex: Database["public"]["Enums"]["sex"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          metadata?: Json
          organisation_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          organisation_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organisation_id_fkey"
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
      specialist_referrals: {
        Row: {
          appointment_date: string | null
          booking_confirmed_at: string | null
          created_at: string
          id: string
          organisation_id: string
          patient_id: string
          referral_fee_kobo: number
          referral_reason: string | null
          screening_upgrade_id: string | null
          specialist_type: Database["public"]["Enums"]["specialist_type"]
          status: Database["public"]["Enums"]["referral_status"]
          updated_at: string
        }
        Insert: {
          appointment_date?: string | null
          booking_confirmed_at?: string | null
          created_at?: string
          id?: string
          organisation_id: string
          patient_id: string
          referral_fee_kobo?: number
          referral_reason?: string | null
          screening_upgrade_id?: string | null
          specialist_type: Database["public"]["Enums"]["specialist_type"]
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
        }
        Update: {
          appointment_date?: string | null
          booking_confirmed_at?: string | null
          created_at?: string
          id?: string
          organisation_id?: string
          patient_id?: string
          referral_fee_kobo?: number
          referral_reason?: string | null
          screening_upgrade_id?: string | null
          specialist_type?: Database["public"]["Enums"]["specialist_type"]
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
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
          price_minor: number
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
          price_minor?: number
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
          price_minor?: number
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
          plan_id: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
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
          plan_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
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
          plan_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
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
      symptoms: {
        Row: {
          created_at: string
          description: string
          id: string
          is_red_flag: boolean
          organisation_id: string
          patient_id: string
          reported_at: string
          severity: number | null
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_red_flag?: boolean
          organisation_id: string
          patient_id: string
          reported_at?: string
          severity?: number | null
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_red_flag?: boolean
          organisation_id?: string
          patient_id?: string
          reported_at?: string
          severity?: number | null
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
          certificate_url: string | null
          created_at: string
          date_administered: string
          dose_number: number
          id: string
          organisation_id: string
          profile_id: string
          provider: string | null
          updated_at: string
          vaccination_catalog_id: string
        }
        Insert: {
          certificate_url?: string | null
          created_at?: string
          date_administered: string
          dose_number?: number
          id?: string
          organisation_id: string
          profile_id: string
          provider?: string | null
          updated_at?: string
          vaccination_catalog_id: string
        }
        Update: {
          certificate_url?: string | null
          created_at?: string
          date_administered?: string
          dose_number?: number
          id?: string
          organisation_id?: string
          profile_id?: string
          provider?: string | null
          updated_at?: string
          vaccination_catalog_id?: string
        }
        Relationships: [
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
        ]
      }
      vitals_readings: {
        Row: {
          created_at: string
          diastolic: number | null
          glucose_context: Database["public"]["Enums"]["glucose_context"] | null
          glucose_mmol_l: number | null
          id: string
          note: string | null
          organisation_id: string
          patient_id: string
          pulse_bpm: number | null
          spo2_pct: number | null
          systolic: number | null
          taken_at: string
          temperature_c: number | null
          vital_type: Database["public"]["Enums"]["vital_type"]
          weight_kg: number | null
        }
        Insert: {
          created_at?: string
          diastolic?: number | null
          glucose_context?:
            | Database["public"]["Enums"]["glucose_context"]
            | null
          glucose_mmol_l?: number | null
          id?: string
          note?: string | null
          organisation_id: string
          patient_id: string
          pulse_bpm?: number | null
          spo2_pct?: number | null
          systolic?: number | null
          taken_at?: string
          temperature_c?: number | null
          vital_type: Database["public"]["Enums"]["vital_type"]
          weight_kg?: number | null
        }
        Update: {
          created_at?: string
          diastolic?: number | null
          glucose_context?:
            | Database["public"]["Enums"]["glucose_context"]
            | null
          glucose_mmol_l?: number | null
          id?: string
          note?: string | null
          organisation_id?: string
          patient_id?: string
          pulse_bpm?: number | null
          spo2_pct?: number | null
          systolic?: number | null
          taken_at?: string
          temperature_c?: number | null
          vital_type?: Database["public"]["Enums"]["vital_type"]
          weight_kg?: number | null
        }
        Relationships: [
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_ai_coach_daily_limit: { Args: never; Returns: number }
      has_ai_coach_access: { Args: never; Returns: boolean }
    }
    Enums: {
      alert_level:
        | "routine"
        | "clinician_review"
        | "urgent_escalation"
        | "emergency"
      alert_status: "open" | "acknowledged" | "resolved"
      annual_check_status: "pending" | "in_progress" | "completed"
      appointment_status: "scheduled" | "completed" | "cancelled" | "no_show"
      billing_interval: "monthly" | "yearly"
      booking_request_status:
        | "requested"
        | "confirmed"
        | "completed"
        | "cancelled"
      care_plan_condition:
        | "hypertension"
        | "diabetes"
        | "obesity"
        | "ckd"
        | "cardiovascular"
        | "other"
      care_plan_status: "draft" | "active" | "completed" | "cancelled"
      commission_status: "pending" | "confirmed" | "paid"
      commission_type: "lab" | "pharmacy" | "referral"
      contract_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "paid"
        | "active"
      currency: "NGN" | "GBP" | "USD"
      escalation_status: "open" | "under_review" | "resolved" | "referred"
      facility_type:
        | "hospital"
        | "lab"
        | "pharmacy"
        | "radiology"
        | "optician"
        | "vaccination_centre"
      family_relationship: "spouse" | "parent" | "child" | "sibling" | "other"
      glucose_context: "fasting" | "random" | "post_meal"
      lab_order_status:
        | "ordered"
        | "sample_collected"
        | "processing"
        | "resulted"
        | "cancelled"
      medication_log_status: "taken" | "missed" | "skipped"
      medication_source: "clinician" | "patient"
      notification_channel: "email" | "sms" | "in_app" | "whatsapp" | "push"
      notification_status: "pending" | "sent" | "delivered" | "failed" | "read"
      organisation_type:
        | "clinic"
        | "hmo"
        | "corporate"
        | "lab"
        | "pharmacy"
        | "direct_consumer"
      payment_provider: "paystack" | "stripe"
      pharmacy_order_status:
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
      profile_access_level: "view" | "manage"
      referral_reward_status: "pending" | "earned" | "paid"
      referral_status:
        | "pending"
        | "booked"
        | "confirmed"
        | "completed"
        | "declined"
      referral_type:
        | "patient_refers_patient"
        | "doctor_refers_patient"
        | "corporate_champion"
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
      vital_type:
        | "blood_pressure"
        | "glucose"
        | "weight"
        | "pulse"
        | "temperature"
        | "spo2"
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
      annual_check_status: ["pending", "in_progress", "completed"],
      appointment_status: ["scheduled", "completed", "cancelled", "no_show"],
      billing_interval: ["monthly", "yearly"],
      booking_request_status: [
        "requested",
        "confirmed",
        "completed",
        "cancelled",
      ],
      care_plan_condition: [
        "hypertension",
        "diabetes",
        "obesity",
        "ckd",
        "cardiovascular",
        "other",
      ],
      care_plan_status: ["draft", "active", "completed", "cancelled"],
      commission_status: ["pending", "confirmed", "paid"],
      commission_type: ["lab", "pharmacy", "referral"],
      contract_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "paid",
        "active",
      ],
      currency: ["NGN", "GBP", "USD"],
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
      glucose_context: ["fasting", "random", "post_meal"],
      lab_order_status: [
        "ordered",
        "sample_collected",
        "processing",
        "resulted",
        "cancelled",
      ],
      medication_log_status: ["taken", "missed", "skipped"],
      medication_source: ["clinician", "patient"],
      notification_channel: ["email", "sms", "in_app", "whatsapp", "push"],
      notification_status: ["pending", "sent", "delivered", "failed", "read"],
      organisation_type: [
        "clinic",
        "hmo",
        "corporate",
        "lab",
        "pharmacy",
        "direct_consumer",
      ],
      payment_provider: ["paystack", "stripe"],
      pharmacy_order_status: [
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
      profile_access_level: ["view", "manage"],
      referral_reward_status: ["pending", "earned", "paid"],
      referral_status: [
        "pending",
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
      ],
      vital_type: [
        "blood_pressure",
        "glucose",
        "weight",
        "pulse",
        "temperature",
        "spo2",
      ],
    },
  },
} as const

