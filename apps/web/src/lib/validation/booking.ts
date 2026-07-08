import { z } from "zod";

export const bookingRequestSchema = z.object({
  facility_id: z.string().uuid(),
  service_type: z.string().trim().min(1, "Tell us what you need").max(200),
  requested_date: z.string().refine(
    (value) => {
      if (Number.isNaN(Date.parse(value))) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(value) >= today;
    },
    { message: "Choose today or a future date" }
  ),
  notes: z.string().trim().max(500).optional(),
});
export type BookingRequestInput = z.infer<typeof bookingRequestSchema>;
