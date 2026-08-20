"use client";

import { useBookingRequests, type BookingRequestWithFacility } from "@/lib/queries/facilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SEMANTIC_ICON } from "@/lib/icons";

const STATUS_BADGE: Record<
  BookingRequestWithFacility["status"],
  { variant: BadgeProps["variant"]; label: string }
> = {
  requested: { variant: "amber", label: "Requested" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "green", label: "Completed" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

export function BookingRequestsList({ patientId }: { patientId: string }) {
  const bookingRequests = useBookingRequests(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.booking className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your booking requests
        </CardTitle>
      </CardHeader>
      <CardContent>
        {bookingRequests.isLoading && (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 py-1">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        )}
        {bookingRequests.isError && (
          <p className="text-sm text-red-600">Could not load your booking requests.</p>
        )}
        {!bookingRequests.isLoading &&
          !bookingRequests.isError &&
          bookingRequests.data?.length === 0 && (
            <EmptyState
              icon={SEMANTIC_ICON.booking}
              title="No booking requests on file"
            />
          )}
        {bookingRequests.data && bookingRequests.data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {bookingRequests.data.map((request) => {
              const badge = STATUS_BADGE[request.status];
              return (
                <li key={request.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {request.facilities?.name ?? "Facility"}
                    </p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {request.service_type}, requested for{" "}
                    {new Date(request.requested_date).toLocaleDateString()}
                  </p>
                  {request.notes && (
                    <p className="text-xs text-charcoal-ink/60">{request.notes}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
