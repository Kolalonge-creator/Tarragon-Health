"use client";

import { CalendarClock, Clock, UserCheck, Users } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { useStaffActivity } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import { CenterNote, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

export function TeamDashboard() {
  const { data, isLoading } = useStaffActivity();

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-soft-sage/50 px-3 py-2 text-xs text-charcoal-ink/70">
        Login activity for Tarragon team members (admin, clinician, doctor, care coordinator,
        analyst). Sessions are reconstructed from platform activity with a 30-minute idle gap;
        duration reflects active time on the platform. No IP is stored.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Team members" value={formatNumber(data?.staff_total ?? 0)} />
        <StatTile icon={UserCheck} label="Active today" value={formatNumber(data?.active_today ?? 0)} />
        <StatTile icon={CalendarClock} label="Active this week" value={formatNumber(data?.active_7d ?? 0)} />
        <StatTile icon={Clock} label="Sessions (period)" value={formatNumber(data?.sessions_total ?? 0)} />
      </div>

      <SectionCard
        title="Per team member"
        description="Total sessions, active time and last seen."
        actions={<ExportButton filename="team-activity-summary" rows={data?.by_staff ?? []} />}
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (data?.by_staff ?? []).length === 0 ? (
          <CenterNote>No team activity captured yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Team member</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 text-right font-medium">Sessions</th>
                  <th className="py-2 pr-4 text-right font-medium">Active time</th>
                  <th className="py-2 pr-4 text-right font-medium">Pageviews</th>
                  <th className="py-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {(data?.by_staff ?? []).map((s) => (
                  <tr key={`${s.staff}-${s.role}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink/80">{s.staff}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/60">{s.role.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(s.sessions)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmtDuration(s.active_minutes)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(s.pageviews)}</td>
                    <td className="py-2 whitespace-nowrap text-charcoal-ink/60">{fmtWhen(s.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Recent login sessions"
        description="Most recent sessions across the team."
        actions={<ExportButton filename="team-sessions" rows={data?.recent_sessions ?? []} />}
      >
        {isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (data?.recent_sessions ?? []).length === 0 ? (
          <CenterNote>No sessions yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Team member</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Logged in</th>
                  <th className="py-2 pr-4 font-medium">Until</th>
                  <th className="py-2 pr-4 text-right font-medium">Duration</th>
                  <th className="py-2 text-right font-medium">Pageviews</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_sessions ?? []).map((s, i) => (
                  <tr key={`${s.staff}-${s.started}-${i}`} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 text-charcoal-ink/80">{s.staff}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/60">{s.role.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/70">{fmtWhen(s.started)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-charcoal-ink/60">{fmtTime(s.ended)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium">{fmtDuration(s.duration_min)}</td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(s.pageviews)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
