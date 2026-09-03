"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

/**
 * 55.10/55.11/55.16 device & data operations dashboard queries.
 *
 * integration_health_status/integration_incidents are plain tables (any org
 * staff may read — platform-wide infra, not per-tenant, see the migration
 * that created them) so these two go through a normal select. The two
 * cross-patient aggregate RPCs (device_connection_data_quality, rpm_sla_metrics)
 * require an explicit organisation_id and are gated server-side via
 * private.is_org_staff — the caller's own org is resolved server-side by the
 * page (see device-operations/page.tsx) and passed down, rather than trusting
 * a client-supplied org id for anything more than which staff's own org to ask
 * about (RLS/the RPC's own check is what actually enforces it).
 */

export type IntegrationHealthStatus = Tables<"integration_health_status">;
export type IntegrationIncident = Tables<"integration_incidents">;

export function useIntegrationHealth() {
  return useQuery({
    queryKey: ["device-operations", "integration-health"],
    queryFn: async () => {
      const supabase = createClient();
      const [statusRes, incidentsRes] = await Promise.all([
        supabase.from("integration_health_status").select("*").order("component"),
        supabase
          .from("integration_incidents")
          .select("*")
          .is("resolved_at", null)
          .order("started_at", { ascending: false }),
      ]);
      if (statusRes.error) throw statusRes.error;
      if (incidentsRes.error) throw incidentsRes.error;
      return {
        status: statusRes.data as IntegrationHealthStatus[],
        openIncidents: incidentsRes.data as IntegrationIncident[],
      };
    },
  });
}

const dataQualityRowSchema = z.object({
  connection_kind: z.string(),
  connection_id: z.string(),
  patient_id: z.string(),
  provider_or_device_type: z.string(),
  status: z.string(),
  last_synced_at: z.string().nullable(),
  is_missing_data: z.boolean().nullable(),
  implausible_readings_count: z.number(),
  duplicate_readings_count: z.number(),
  last_error: z.string().nullable(),
  avg_latency_seconds: z.number().nullable(),
});
export type DeviceDataQualityRow = z.infer<typeof dataQualityRowSchema>;

export function useDeviceDataQuality(organisationId: string | null) {
  return useQuery({
    queryKey: ["device-operations", "data-quality", organisationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("device_connection_data_quality", {
        p_organisation_id: organisationId as string,
      });
      if (error) throw error;
      return z.array(dataQualityRowSchema).parse(data);
    },
    enabled: !!organisationId,
  });
}

const rpmSlaMetricsSchema = z.object({
  organisation_id: z.string(),
  since: z.string(),
  computed_at: z.string(),
  measurement_latency_seconds: z.object({
    avg: z.number().nullable(),
    p95: z.number().nullable(),
  }),
  alert_ack_latency_minutes: z.object({
    avg: z.number().nullable(),
    p95: z.number().nullable(),
    count: z.number(),
  }),
  technical_downtime_minutes_by_component: z.array(
    z.object({ component: z.string(), downtime_minutes: z.number() })
  ),
  device_reporting_adherence_pct: z.number().nullable(),
});
export type RpmSlaMetrics = z.infer<typeof rpmSlaMetricsSchema>;

export function useRpmSlaMetrics(organisationId: string | null) {
  return useQuery({
    queryKey: ["device-operations", "rpm-sla", organisationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("rpm_sla_metrics", {
        p_organisation_id: organisationId as string,
      });
      if (error) throw error;
      return rpmSlaMetricsSchema.parse(data);
    },
    enabled: !!organisationId,
  });
}
