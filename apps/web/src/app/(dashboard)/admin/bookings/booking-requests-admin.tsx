"use client";

import {
  useAdminBookingRequests,
  useUpdateBookingRequestStatus,
  type BookingRequest,
} from "@/lib/queries/booking-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";

const STATUS_BADGE: Record<BookingRequest["status"], { variant: BadgeProps["variant"]; label: string }> = {
  requested: { variant: "amber", label: "Requested" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

const STATUS_OPTIONS: BookingRequest["status"][] = ["requested", "confirmed", "completed", "cancelled"];

export function BookingRequestsAdmin() {
  const bookingRequests = useAdminBookingRequests();
  const updateStatus = useUpdateBookingRequestStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle>All requests</CardTitle>
      </CardHeader>
      <CardContent>
        {bookingRequests.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {bookingRequests.isError && (
          <p className="text-sm text-red-600">Could not load booking requests.</p>
        )}
        {!bookingRequests.isLoading &&
          !bookingRequests.isError &&
          bookingRequests.data?.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No booking requests yet.</p>
          )}
        {bookingRequests.data && bookingRequests.data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {bookingRequests.data.map((request) => {
              const badge = STATUS_BADGE[request.status];
              return (
                <li key={request.id} className="space-y-1 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">
                        {request.patient?.full_name ?? "Unknown patient"}{" "}
                        <span className="font-normal text-charcoal-ink/60">
                          → {request.facilities?.name ?? "Facility"}
                        </span>
                      </p>
                      <p className="text-xs text-charcoal-ink/60">
                        {request.service_type} — requested for{" "}
                        {new Date(request.requested_date).toLocaleDateString()}
                        {request.patient?.phone ? ` · ${request.patient.phone}` : ""}
                      </p>
                      {request.notes && (
                        <p className="text-xs text-charcoal-ink/60">{request.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      <Select
                        value={request.status}
                        disabled={updateStatus.isPending}
                        onChange={(event) =>
                          updateStatus.mutate({
                            id: request.id,
                            status: event.target.value as BookingRequest["status"],
                          })
                        }
                        className="w-36"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_BADGE[status].label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
