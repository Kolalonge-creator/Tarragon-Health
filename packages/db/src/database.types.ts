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
      app_config: {
        Row: {
          accountability_model: Database["public"]["Enums"]["accountability_model"]
          accountability_model_set_at: string | null
          accountability_model_set_by: string | null
          id: boolean
          l1_set_at: string | null
          l1_set_by: string | null
          l1_who_hearts_v1_approved: boolean
          l2_dpo_name: string | null
          l2_ndpc_registration_complete: boolean
          l2_set_at: string | null
          l2_set_by: string | null
          l3_accountability_model_legal_advice: boolean
          l3_set_at: string | null
          l3_set_by: string | null
          l4_criteria_version: string | null
          l4_referral_criteria_v1_published: boolean
          l4_set_at: string | null
          l4_set_by: string | null
          updated_at: string
        }
        Insert: {
          accountability_model?: Database["public"]["Enums"]["accountability_model"]
          accountability_model_set_at?: string | null
          accountability_model_set_by?: string | null
          id?: boolean
          l1_set_at?: string | null
          l1_set_by?: string | null
          l1_who_hearts_v1_approved?: boolean
          l2_dpo_name?: string | null
          l2_ndpc_registration_complete?: boolean
          l2_set_at?: string | null
          l2_set_by?: string | null
          l3_accountability_model_legal_advice?: boolean
          l3_set_at?: string | null
          l3_set_by?: string | null
          l4_criteria_version?: string | null
          l4_referral_criteria_v1_published?: boolean
          l4_set_at?: string | null
          l4_set_by?: string | null
          updated_at?: string
        }
        Update: {
          accountability_model?: Database["public"]["Enums"]["accountability_model"]
          accountability_model_set_at?: string | null
          accountability_model_set_by?: string | null
          id?: boolean
          l1_set_at?: string | null
          l1_set_by?: string | null
          l1_who_hearts_v1_approved?: boolean
          l2_dpo_name?: string | null
          l2_ndpc_registration_complete?: boolean
          l2_set_at?: string | null
          l2_set_by?: string | null
          l3_accountability_model_legal_advice?: boolean
          l3_set_at?: string | null
          l3_set_by?: string | null
          l4_criteria_version?: string | null
          l4_referral_criteria_v1_published?: boolean
          l4_set_at?: string | null
          l4_set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_config_accountability_model_set_by_fkey"
            columns: ["accountability_model_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_config_l1_set_by_fkey"
            columns: ["l1_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_config_l2_set_by_fkey"
            columns: ["l2_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_config_l3_set_by_fkey"
            columns: ["l3_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_config_l4_set_by_fkey"
            columns: ["l4_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          after: Json | null
          before: Json | null
          id: number
          ip: unknown
          occurred_at: string
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          id?: number
          ip?: unknown
          occurred_at?: string
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          id?: number
          ip?: unknown
          occurred_at?: string
          row_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_contacts: {
        Row: {
          clinician_id: string | null
          contact_type: Database["public"]["Enums"]["contact_type"]
          coordinator_id: string | null
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          id: string
          masked_call_ref: string | null
          patient_id: string
          started_at: string
        }
        Insert: {
          clinician_id?: string | null
          contact_type: Database["public"]["Enums"]["contact_type"]
          coordinator_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          masked_call_ref?: string | null
          patient_id: string
          started_at: string
        }
        Update: {
          clinician_id?: string | null
          contact_type?: Database["public"]["Enums"]["contact_type"]
          coordinator_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          masked_call_ref?: string | null
          patient_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_contacts_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_contacts_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_contacts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_notes: {
        Row: {
          accountability_model_at_signing: Database["public"]["Enums"]["accountability_model"]
          body: string
          clinician_id: string
          id: string
          linked_classification_id: string | null
          linked_contact_id: string | null
          mdcn_number_at_signing: string
          note_type: string
          patient_id: string
          signed_at: string
        }
        Insert: {
          accountability_model_at_signing: Database["public"]["Enums"]["accountability_model"]
          body: string
          clinician_id: string
          id?: string
          linked_classification_id?: string | null
          linked_contact_id?: string | null
          mdcn_number_at_signing: string
          note_type: string
          patient_id: string
          signed_at?: string
        }
        Update: {
          accountability_model_at_signing?: Database["public"]["Enums"]["accountability_model"]
          body?: string
          clinician_id?: string
          id?: string
          linked_classification_id?: string | null
          linked_contact_id?: string | null
          mdcn_number_at_signing?: string
          note_type?: string
          patient_id?: string
          signed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_notes_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_linked_classification_id_fkey"
            columns: ["linked_classification_id"]
            isOneToOne: false
            referencedRelation: "triage_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "clinical_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinicians: {
        Row: {
          active: boolean
          id: string
          indemnity_expiry: string | null
          indemnity_policy_no: string | null
          indemnity_provider: string | null
          mdcn_expiry: string
          mdcn_number: string
          profile_id: string
          scope: string[]
          suspended_reason: string | null
        }
        Insert: {
          active?: boolean
          id?: string
          indemnity_expiry?: string | null
          indemnity_policy_no?: string | null
          indemnity_provider?: string | null
          mdcn_expiry: string
          mdcn_number: string
          profile_id: string
          scope?: string[]
          suspended_reason?: string | null
        }
        Update: {
          active?: boolean
          id?: string
          indemnity_expiry?: string | null
          indemnity_policy_no?: string | null
          indemnity_provider?: string | null
          mdcn_expiry?: string
          mdcn_number?: string
          profile_id?: string
          scope?: string[]
          suspended_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinicians_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          capture_method: string
          captured_by: string | null
          evidence_path: string | null
          expires_at: string | null
          granted_at: string
          granted_to_organisation_id: string | null
          granted_to_profile_id: string | null
          id: string
          patient_id: string
          revoked_at: string | null
          scope: Database["public"]["Enums"]["consent_scope"]
        }
        Insert: {
          capture_method: string
          captured_by?: string | null
          evidence_path?: string | null
          expires_at?: string | null
          granted_at?: string
          granted_to_organisation_id?: string | null
          granted_to_profile_id?: string | null
          id?: string
          patient_id: string
          revoked_at?: string | null
          scope: Database["public"]["Enums"]["consent_scope"]
        }
        Update: {
          capture_method?: string
          captured_by?: string | null
          evidence_path?: string | null
          expires_at?: string | null
          granted_at?: string
          granted_to_organisation_id?: string | null
          granted_to_profile_id?: string | null
          id?: string
          patient_id?: string
          revoked_at?: string | null
          scope?: Database["public"]["Enums"]["consent_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_granted_to_organisation_id_fkey"
            columns: ["granted_to_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_granted_to_profile_id_fkey"
            columns: ["granted_to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      device_heartbeats: {
        Row: {
          app_version: string | null
          consecutive_push_failures: number
          device_model: string | null
          expo_push_token: string | null
          forced_channel: Database["public"]["Enums"]["comms_channel"] | null
          id: string
          last_seen_at: string
          os: string | null
          os_version: string | null
          patient_id: string
          push_permission_granted: boolean
        }
        Insert: {
          app_version?: string | null
          consecutive_push_failures?: number
          device_model?: string | null
          expo_push_token?: string | null
          forced_channel?: Database["public"]["Enums"]["comms_channel"] | null
          id?: string
          last_seen_at?: string
          os?: string | null
          os_version?: string | null
          patient_id: string
          push_permission_granted: boolean
        }
        Update: {
          app_version?: string | null
          consecutive_push_failures?: number
          device_model?: string | null
          expo_push_token?: string | null
          forced_channel?: Database["public"]["Enums"]["comms_channel"] | null
          id?: string
          last_seen_at?: string
          os?: string | null
          os_version?: string | null
          patient_id?: string
          push_permission_granted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "device_heartbeats_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          approx_age_years: number | null
          arm_circumference_cm: number | null
          created_at: string
          cuff_size: string | null
          device_kind: Database["public"]["Enums"]["reading_type"]
          first_reading_photo_path: string | null
          id: string
          is_wrist: boolean
          make: string
          model: string
          patient_id: string
          photo_path: string | null
          supplied_by_tarragon: boolean
          validated_at: string | null
          validated_by: string | null
          validation: Database["public"]["Enums"]["device_validation"]
        }
        Insert: {
          approx_age_years?: number | null
          arm_circumference_cm?: number | null
          created_at?: string
          cuff_size?: string | null
          device_kind: Database["public"]["Enums"]["reading_type"]
          first_reading_photo_path?: string | null
          id?: string
          is_wrist?: boolean
          make: string
          model: string
          patient_id: string
          photo_path?: string | null
          supplied_by_tarragon?: boolean
          validated_at?: string | null
          validated_by?: string | null
          validation?: Database["public"]["Enums"]["device_validation"]
        }
        Update: {
          approx_age_years?: number | null
          arm_circumference_cm?: number | null
          created_at?: string
          cuff_size?: string | null
          device_kind?: Database["public"]["Enums"]["reading_type"]
          first_reading_photo_path?: string | null
          id?: string
          is_wrist?: boolean
          make?: string
          model?: string
          patient_id?: string
          photo_path?: string | null
          supplied_by_tarragon?: boolean
          validated_at?: string | null
          validated_by?: string | null
          validation?: Database["public"]["Enums"]["device_validation"]
        }
        Relationships: [
          {
            foreignKeyName: "devices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
        ]
      }
      enrolments: {
        Row: {
          assigned_coordinator_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          organisation_id: string | null
          patient_id: string
          programme_code: Database["public"]["Enums"]["programme_code"]
          started_at: string | null
          status: Database["public"]["Enums"]["enrolment_status"]
        }
        Insert: {
          assigned_coordinator_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          organisation_id?: string | null
          patient_id: string
          programme_code: Database["public"]["Enums"]["programme_code"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["enrolment_status"]
        }
        Update: {
          assigned_coordinator_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          organisation_id?: string | null
          patient_id?: string
          programme_code?: Database["public"]["Enums"]["programme_code"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["enrolment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "enrolments_assigned_coordinator_id_fkey"
            columns: ["assigned_coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_programme_code_fkey"
            columns: ["programme_code"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["code"]
          },
        ]
      }
      escalation_slas: {
        Row: {
          channel_sequence: string
          criticality: Database["public"]["Enums"]["criticality"]
          sla_minutes: number
        }
        Insert: {
          channel_sequence: string
          criticality: Database["public"]["Enums"]["criticality"]
          sla_minutes: number
        }
        Update: {
          channel_sequence?: string
          criticality?: Database["public"]["Enums"]["criticality"]
          sla_minutes?: number
        }
        Relationships: []
      }
      escalations: {
        Row: {
          breached: boolean
          classification_id: string | null
          criticality: Database["public"]["Enums"]["criticality"]
          due_by: string
          id: string
          patient_id: string
          raised_at: string
          raised_by: string | null
          resolution_note_id: string | null
          resolved_at: string | null
        }
        Insert: {
          breached?: boolean
          classification_id?: string | null
          criticality: Database["public"]["Enums"]["criticality"]
          due_by: string
          id?: string
          patient_id: string
          raised_at?: string
          raised_by?: string | null
          resolution_note_id?: string | null
          resolved_at?: string | null
        }
        Update: {
          breached?: boolean
          classification_id?: string | null
          criticality?: Database["public"]["Enums"]["criticality"]
          due_by?: string
          id?: string
          patient_id?: string
          raised_at?: string
          raised_by?: string | null
          resolution_note_id?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalations_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "triage_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
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
            foreignKeyName: "escalations_resolution_note_id_fkey"
            columns: ["resolution_note_id"]
            isOneToOne: false
            referencedRelation: "clinical_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          description: string
          id: string
          line_type: Database["public"]["Enums"]["invoice_line_type"]
          organisation_id: string
          period_end: string
          period_start: string
          quantity: number
          unit_amount_minor: number
        }
        Insert: {
          description: string
          id?: string
          line_type: Database["public"]["Enums"]["invoice_line_type"]
          organisation_id: string
          period_end: string
          period_start: string
          quantity: number
          unit_amount_minor: number
        }
        Update: {
          description?: string
          id?: string
          line_type?: Database["public"]["Enums"]["invoice_line_type"]
          organisation_id?: string
          period_end?: string
          period_start?: string
          quantity?: number
          unit_amount_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_orders: {
        Row: {
          collected_at: string | null
          commission_minor: number
          id: string
          ordered_at: string
          panel_code: string
          partner_id: string
          patient_id: string
          patient_price_minor: number
          resulted_at: string | null
        }
        Insert: {
          collected_at?: string | null
          commission_minor: number
          id?: string
          ordered_at?: string
          panel_code: string
          partner_id: string
          patient_id: string
          patient_price_minor: number
          resulted_at?: string | null
        }
        Update: {
          collected_at?: string | null
          commission_minor?: number
          id?: string
          ordered_at?: string
          panel_code?: string
          partner_id?: string
          patient_id?: string
          patient_price_minor?: number
          resulted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_dispenses: {
        Row: {
          batch_number: string | null
          days_supply: number
          dispensed_at: string
          id: string
          medication_id: string
          partner_pharmacy_id: string | null
          patient_id: string
          quantity: number
          verification: Database["public"]["Enums"]["medication_verification"]
        }
        Insert: {
          batch_number?: string | null
          days_supply: number
          dispensed_at?: string
          id?: string
          medication_id: string
          partner_pharmacy_id?: string | null
          patient_id: string
          quantity: number
          verification?: Database["public"]["Enums"]["medication_verification"]
        }
        Update: {
          batch_number?: string | null
          days_supply?: number
          dispensed_at?: string
          id?: string
          medication_id?: string
          partner_pharmacy_id?: string | null
          patient_id?: string
          quantity?: number
          verification?: Database["public"]["Enums"]["medication_verification"]
        }
        Relationships: [
          {
            foreignKeyName: "medication_dispenses_medication_id_fkey"
            columns: ["medication_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_dispenses_partner_pharmacy_id_fkey"
            columns: ["partner_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_dispenses_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          dose_instruction: string
          id: string
          inn_name: string
          patient_id: string
          prescribed_by: string | null
          protocol_step: number | null
          started_at: string
          stopped_at: string | null
          strength: string
        }
        Insert: {
          dose_instruction: string
          id?: string
          inn_name: string
          patient_id: string
          prescribed_by?: string | null
          protocol_step?: number | null
          started_at: string
          stopped_at?: string | null
          strength: string
        }
        Update: {
          dose_instruction?: string
          id?: string
          inn_name?: string
          patient_id?: string
          prescribed_by?: string | null
          protocol_step?: number | null
          started_at?: string
          stopped_at?: string | null
          strength?: string
        }
        Relationships: [
          {
            foreignKeyName: "medications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_prescribed_by_fkey"
            columns: ["prescribed_by"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          detail: Json | null
          id: string
          occurred_at: string
          send_id: string
          state: Database["public"]["Enums"]["delivery_state"]
        }
        Insert: {
          detail?: Json | null
          id?: string
          occurred_at?: string
          send_id: string
          state: Database["public"]["Enums"]["delivery_state"]
        }
        Update: {
          detail?: Json | null
          id?: string
          occurred_at?: string
          send_id?: string
          state?: Database["public"]["Enums"]["delivery_state"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "notification_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_sends: {
        Row: {
          channel: Database["public"]["Enums"]["comms_channel"]
          content_class: Database["public"]["Enums"]["content_class"]
          cost_minor: number | null
          criticality: Database["public"]["Enums"]["criticality"]
          id: string
          patient_id: string
          queued_at: string
          template_id: string
          vendor_message_id: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["comms_channel"]
          content_class: Database["public"]["Enums"]["content_class"]
          cost_minor?: number | null
          criticality: Database["public"]["Enums"]["criticality"]
          id?: string
          patient_id: string
          queued_at?: string
          template_id: string
          vendor_message_id?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["comms_channel"]
          content_class?: Database["public"]["Enums"]["content_class"]
          cost_minor?: number | null
          criticality?: Database["public"]["Enums"]["criticality"]
          id?: string
          patient_id?: string
          queued_at?: string
          template_id?: string
          vendor_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_sends_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          active: boolean
          body_template: string
          channel: Database["public"]["Enums"]["comms_channel"]
          content_class: Database["public"]["Enums"]["content_class"]
          criticality: Database["public"]["Enums"]["criticality"]
          id: string
          key: string
          vendor_template_name: string | null
        }
        Insert: {
          active?: boolean
          body_template: string
          channel: Database["public"]["Enums"]["comms_channel"]
          content_class: Database["public"]["Enums"]["content_class"]
          criticality: Database["public"]["Enums"]["criticality"]
          id?: string
          key: string
          vendor_template_name?: string | null
        }
        Update: {
          active?: boolean
          body_template?: string
          channel?: Database["public"]["Enums"]["comms_channel"]
          content_class?: Database["public"]["Enums"]["content_class"]
          criticality?: Database["public"]["Enums"]["criticality"]
          id?: string
          key?: string
          vendor_template_name?: string | null
        }
        Relationships: []
      }
      organisations: {
        Row: {
          aggregate_only: boolean
          contact_email: string
          created_at: string
          id: string
          min_cohort_size: number
          name: string
          rc_number: string | null
        }
        Insert: {
          aggregate_only?: boolean
          contact_email: string
          created_at?: string
          id?: string
          min_cohort_size?: number
          name: string
          rc_number?: string | null
        }
        Update: {
          aggregate_only?: boolean
          contact_email?: string
          created_at?: string
          id?: string
          min_cohort_size?: number
          name?: string
          rc_number?: string | null
        }
        Relationships: []
      }
      partners: {
        Row: {
          accreditation: string | null
          active: boolean
          commission_bps: number | null
          id: string
          kind: string
          nafdac_licence: string | null
          name: string
          pcn_licence: string | null
        }
        Insert: {
          accreditation?: string | null
          active?: boolean
          commission_bps?: number | null
          id?: string
          kind: string
          nafdac_licence?: string | null
          name: string
          pcn_licence?: string | null
        }
        Update: {
          accreditation?: string | null
          active?: boolean
          commission_bps?: number | null
          id?: string
          kind?: string
          nafdac_licence?: string | null
          name?: string
          pcn_licence?: string | null
        }
        Relationships: []
      }
      patients: {
        Row: {
          created_at: string
          date_of_birth: string
          guardian_patient_id: string | null
          id: string
          lga: string | null
          next_of_kin_name: string | null
          next_of_kin_phone_e164: string | null
          no_smartphone: boolean
          profile_id: string | null
          sex_at_birth: Database["public"]["Enums"]["sex_at_birth"]
          state_of_residence: string | null
        }
        Insert: {
          created_at?: string
          date_of_birth: string
          guardian_patient_id?: string | null
          id?: string
          lga?: string | null
          next_of_kin_name?: string | null
          next_of_kin_phone_e164?: string | null
          no_smartphone?: boolean
          profile_id?: string | null
          sex_at_birth: Database["public"]["Enums"]["sex_at_birth"]
          state_of_residence?: string | null
        }
        Update: {
          created_at?: string
          date_of_birth?: string
          guardian_patient_id?: string | null
          id?: string
          lga?: string | null
          next_of_kin_name?: string | null
          next_of_kin_phone_e164?: string | null
          no_smartphone?: boolean
          profile_id?: string | null
          sex_at_birth?: Database["public"]["Enums"]["sex_at_birth"]
          state_of_residence?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_guardian_patient_id_fkey"
            columns: ["guardian_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          locale: string
          phone_e164: string | null
          role: Database["public"]["Enums"]["user_role"]
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          locale?: string
          phone_e164?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          locale?: string
          phone_e164?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      programmes: {
        Row: {
          active: boolean
          code: Database["public"]["Enums"]["programme_code"]
          display_name: string
        }
        Insert: {
          active?: boolean
          code: Database["public"]["Enums"]["programme_code"]
          display_name: string
        }
        Update: {
          active?: boolean
          code?: Database["public"]["Enums"]["programme_code"]
          display_name?: string
        }
        Relationships: []
      }
      proof_log: {
        Row: {
          actor_display: string
          actor_profile_id: string | null
          event_type: string
          id: string
          occurred_at: string
          patient_id: string
          source_id: string
          source_table: string
          summary: string
        }
        Insert: {
          actor_display: string
          actor_profile_id?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          patient_id: string
          source_id: string
          source_table: string
          summary: string
        }
        Update: {
          actor_display?: string
          actor_profile_id?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          patient_id?: string
          source_id?: string
          source_table?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_log_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      protocol_configs: {
        Row: {
          approved_at: string
          approved_by: string
          code: string
          effective_from: string
          effective_to: string | null
          id: string
          ruleset: Json
          version: string
        }
        Insert: {
          approved_at: string
          approved_by: string
          code: string
          effective_from: string
          effective_to?: string | null
          id?: string
          ruleset: Json
          version: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          code?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          ruleset?: Json
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_configs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
        ]
      }
      readings: {
        Row: {
          created_at: string
          device_id: string | null
          diastolic: number | null
          entered_by: string | null
          id: string
          notes: string | null
          patient_id: string
          screening_event_id: string | null
          source: Database["public"]["Enums"]["reading_source"]
          source_detail: string
          systolic: number | null
          taken_at: string
          type: Database["public"]["Enums"]["reading_type"]
          unit: string
          value_numeric: number | null
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          diastolic?: number | null
          entered_by?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          screening_event_id?: string | null
          source: Database["public"]["Enums"]["reading_source"]
          source_detail: string
          systolic?: number | null
          taken_at: string
          type: Database["public"]["Enums"]["reading_type"]
          unit: string
          value_numeric?: number | null
        }
        Update: {
          created_at?: string
          device_id?: string | null
          diastolic?: number | null
          entered_by?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          screening_event_id?: string | null
          source?: Database["public"]["Enums"]["reading_source"]
          source_detail?: string
          systolic?: number | null
          taken_at?: string
          type?: Database["public"]["Enums"]["reading_type"]
          unit?: string
          value_numeric?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_screening_event_id_fkey"
            columns: ["screening_event_id"]
            isOneToOne: false
            referencedRelation: "screening_events"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          clinician_id: string
          criteria_version: string
          id: string
          patient_id: string
          patient_informed_at: string | null
          reason: Database["public"]["Enums"]["referral_reason"]
          reason_detail: string | null
          referred_at: string
          referred_to: string | null
        }
        Insert: {
          clinician_id: string
          criteria_version: string
          id?: string
          patient_id: string
          patient_informed_at?: string | null
          reason: Database["public"]["Enums"]["referral_reason"]
          reason_detail?: string | null
          referred_at?: string
          referred_to?: string | null
        }
        Update: {
          clinician_id?: string
          criteria_version?: string
          id?: string
          patient_id?: string
          patient_informed_at?: string | null
          reason?: Database["public"]["Enums"]["referral_reason"]
          reason_detail?: string | null
          referred_at?: string
          referred_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_events: {
        Row: {
          created_at: string
          held_on: string
          id: string
          location: string | null
          name: string
          operator_profile_id: string | null
          organisation_id: string | null
          participants_expected: number | null
        }
        Insert: {
          created_at?: string
          held_on: string
          id?: string
          location?: string | null
          name: string
          operator_profile_id?: string | null
          organisation_id?: string | null
          participants_expected?: number | null
        }
        Update: {
          created_at?: string
          held_on?: string
          id?: string
          location?: string | null
          name?: string
          operator_profile_id?: string | null
          organisation_id?: string | null
          participants_expected?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "screening_events_operator_profile_id_fkey"
            columns: ["operator_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_participants: {
        Row: {
          consent_record_id: string | null
          consented: boolean
          converted_at: string | null
          converted_to_enrolment_id: string | null
          id: string
          patient_id: string | null
          screening_event_id: string
          temp_ref: string
        }
        Insert: {
          consent_record_id?: string | null
          consented?: boolean
          converted_at?: string | null
          converted_to_enrolment_id?: string | null
          id?: string
          patient_id?: string | null
          screening_event_id: string
          temp_ref: string
        }
        Update: {
          consent_record_id?: string | null
          consented?: boolean
          converted_at?: string | null
          converted_to_enrolment_id?: string | null
          id?: string
          patient_id?: string | null
          screening_event_id?: string
          temp_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_participants_consent_record_id_fkey"
            columns: ["consent_record_id"]
            isOneToOne: false
            referencedRelation: "consent_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_participants_converted_to_enrolment_id_fkey"
            columns: ["converted_to_enrolment_id"]
            isOneToOne: false
            referencedRelation: "enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_participants_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_participants_screening_event_id_fkey"
            columns: ["screening_event_id"]
            isOneToOne: false
            referencedRelation: "screening_events"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount_minor: number
          currency: string
          enrolment_id: string
          id: string
          interval: string
          next_charge_at: string | null
          payer_profile_id: string
          provider: string
          status: string
        }
        Insert: {
          amount_minor: number
          currency?: string
          enrolment_id: string
          id?: string
          interval: string
          next_charge_at?: string | null
          payer_profile_id: string
          provider: string
          status: string
        }
        Update: {
          amount_minor?: number
          currency?: string
          enrolment_id?: string
          id?: string
          interval?: string
          next_charge_at?: string | null
          payer_profile_id?: string
          provider?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_enrolment_id_fkey"
            columns: ["enrolment_id"]
            isOneToOne: false
            referencedRelation: "enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_payer_profile_id_fkey"
            columns: ["payer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      triage_classifications: {
        Row: {
          ai_assisted: boolean
          ai_model: string | null
          batch_signature_id: string | null
          classification: Database["public"]["Enums"]["triage_class"]
          cleared_at: string | null
          cleared_by: string | null
          clinician_override: Database["public"]["Enums"]["triage_class"] | null
          created_at: string
          id: string
          override_reason: string | null
          patient_id: string
          protocol_config_id: string
          reading_id: string
          rule_fired: string
        }
        Insert: {
          ai_assisted?: boolean
          ai_model?: string | null
          batch_signature_id?: string | null
          classification: Database["public"]["Enums"]["triage_class"]
          cleared_at?: string | null
          cleared_by?: string | null
          clinician_override?:
            | Database["public"]["Enums"]["triage_class"]
            | null
          created_at?: string
          id?: string
          override_reason?: string | null
          patient_id: string
          protocol_config_id: string
          reading_id: string
          rule_fired: string
        }
        Update: {
          ai_assisted?: boolean
          ai_model?: string | null
          batch_signature_id?: string | null
          classification?: Database["public"]["Enums"]["triage_class"]
          cleared_at?: string | null
          cleared_by?: string | null
          clinician_override?:
            | Database["public"]["Enums"]["triage_class"]
            | null
          created_at?: string
          id?: string
          override_reason?: string | null
          patient_id?: string
          protocol_config_id?: string
          reading_id?: string
          rule_fired?: string
        }
        Relationships: [
          {
            foreignKeyName: "triage_classifications_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "clinicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_classifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_classifications_protocol_config_id_fkey"
            columns: ["protocol_config_id"]
            isOneToOne: false
            referencedRelation: "protocol_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_classifications_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: true
            referencedRelation: "readings"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount_minor: number
          beneficiary_patient_id: string | null
          id: string
          occurred_at: string
          reference: string
          wallet_id: string
        }
        Insert: {
          amount_minor: number
          beneficiary_patient_id?: string | null
          id?: string
          occurred_at?: string
          reference: string
          wallet_id: string
        }
        Update: {
          amount_minor?: number
          beneficiary_patient_id?: string | null
          id?: string
          occurred_at?: string
          reference?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_beneficiary_patient_id_fkey"
            columns: ["beneficiary_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance_minor: number
          currency: string
          id: string
          owner_profile_id: string
        }
        Insert: {
          balance_minor?: number
          currency?: string
          id?: string
          owner_profile_id: string
        }
        Update: {
          balance_minor?: number
          currency?: string
          id?: string
          owner_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_escalations: {
        Row: {
          breached: boolean | null
          breached_live: boolean | null
          classification_id: string | null
          criticality: Database["public"]["Enums"]["criticality"] | null
          due_by: string | null
          id: string | null
          patient_id: string | null
          raised_at: string | null
          raised_by: string | null
          resolution_note_id: string | null
          resolved_at: string | null
        }
        Insert: {
          breached?: boolean | null
          breached_live?: never
          classification_id?: string | null
          criticality?: Database["public"]["Enums"]["criticality"] | null
          due_by?: string | null
          id?: string | null
          patient_id?: string | null
          raised_at?: string | null
          raised_by?: string | null
          resolution_note_id?: string | null
          resolved_at?: string | null
        }
        Update: {
          breached?: boolean | null
          breached_live?: never
          classification_id?: string | null
          criticality?: Database["public"]["Enums"]["criticality"] | null
          due_by?: string | null
          id?: string | null
          patient_id?: string | null
          raised_at?: string | null
          raised_by?: string | null
          resolution_note_id?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalations_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "triage_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
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
            foreignKeyName: "escalations_resolution_note_id_fkey"
            columns: ["resolution_note_id"]
            isOneToOne: false
            referencedRelation: "clinical_notes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      clinical_notes_summary: {
        Args: never
        Returns: {
          clinician_id: string
          id: string
          linked_classification_id: string
          linked_contact_id: string
          note_type: string
          patient_id: string
          signed_at: string
        }[]
      }
      lab_orders_patient: {
        Args: never
        Returns: {
          collected_at: string
          id: string
          ordered_at: string
          panel_code: string
          partner_id: string
          patient_id: string
          patient_price_minor: number
          resulted_at: string
        }[]
      }
    }
    Enums: {
      accountability_model: "tech_layer" | "provider"
      comms_channel: "push" | "in_app" | "whatsapp" | "sms" | "email" | "voice"
      consent_scope:
        | "funder_summary"
        | "institution_aggregate"
        | "clinical_share"
        | "escalation_contact"
        | "research_anonymised"
      contact_type:
        | "voice"
        | "synchronous_in_app"
        | "async_in_app"
        | "field_visit"
      content_class: "clinical" | "non_clinical"
      criticality: "routine" | "important" | "urgent" | "emergency"
      delivery_state:
        | "queued"
        | "sent"
        | "delivered"
        | "failed"
        | "opened"
        | "acted"
      device_validation:
        | "validated"
        | "unvalidated_advisory"
        | "wrist_advisory"
        | "unknown"
      enrolment_status: "pending" | "active" | "paused" | "exited"
      invoice_line_type:
        | "service_fee"
        | "performance_bonus"
        | "device"
        | "onboarding"
      medication_verification: "verified" | "unverified" | "unknown"
      programme_code: "control" | "concierge"
      reading_source:
        | "patient_manual"
        | "patient_device_bt"
        | "screening_day"
        | "clinician_entered"
        | "lab_import"
      reading_type:
        | "bp"
        | "glucose_fasting"
        | "glucose_random"
        | "hba1c"
        | "weight"
        | "height"
        | "waist"
        | "pulse"
      referral_reason:
        | "out_of_protocol"
        | "secondary_hypertension_suspected"
        | "type_1_diabetes"
        | "pregnancy"
        | "ckd_stage_3plus"
        | "cardiac_symptoms"
        | "uncontrolled_at_max_protocol"
        | "patient_request"
        | "other"
      sex_at_birth: "female" | "male"
      triage_class: "stable" | "needs_review" | "urgent" | "emergency"
      user_role:
        | "patient"
        | "clinician"
        | "coordinator"
        | "institution_admin"
        | "ops_admin"
        | "superadmin"
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
      accountability_model: ["tech_layer", "provider"],
      comms_channel: ["push", "in_app", "whatsapp", "sms", "email", "voice"],
      consent_scope: [
        "funder_summary",
        "institution_aggregate",
        "clinical_share",
        "escalation_contact",
        "research_anonymised",
      ],
      contact_type: [
        "voice",
        "synchronous_in_app",
        "async_in_app",
        "field_visit",
      ],
      content_class: ["clinical", "non_clinical"],
      criticality: ["routine", "important", "urgent", "emergency"],
      delivery_state: [
        "queued",
        "sent",
        "delivered",
        "failed",
        "opened",
        "acted",
      ],
      device_validation: [
        "validated",
        "unvalidated_advisory",
        "wrist_advisory",
        "unknown",
      ],
      enrolment_status: ["pending", "active", "paused", "exited"],
      invoice_line_type: [
        "service_fee",
        "performance_bonus",
        "device",
        "onboarding",
      ],
      medication_verification: ["verified", "unverified", "unknown"],
      programme_code: ["control", "concierge"],
      reading_source: [
        "patient_manual",
        "patient_device_bt",
        "screening_day",
        "clinician_entered",
        "lab_import",
      ],
      reading_type: [
        "bp",
        "glucose_fasting",
        "glucose_random",
        "hba1c",
        "weight",
        "height",
        "waist",
        "pulse",
      ],
      referral_reason: [
        "out_of_protocol",
        "secondary_hypertension_suspected",
        "type_1_diabetes",
        "pregnancy",
        "ckd_stage_3plus",
        "cardiac_symptoms",
        "uncontrolled_at_max_protocol",
        "patient_request",
        "other",
      ],
      sex_at_birth: ["female", "male"],
      triage_class: ["stable", "needs_review", "urgent", "emergency"],
      user_role: [
        "patient",
        "clinician",
        "coordinator",
        "institution_admin",
        "ops_admin",
        "superadmin",
      ],
    },
  },
} as const
