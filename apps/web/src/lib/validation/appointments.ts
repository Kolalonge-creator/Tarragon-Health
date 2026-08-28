import { z } from "zod";

export const appointmentTypeSchema = z.enum([
  "gp",
  "specialist",
  "nurse",
  "dietitian",
  "physiotherapist",
  "laboratory",
  "imaging",
  "vaccination",
  "physical_clinic",
  "telemedicine",
  "follow_up",
  "procedure",
]);
export type AppointmentTypeInput = z.infer<typeof appointmentTypeSchema>;

export const consultationMethodSchema = z.enum(["telemedicine", "in_person"]);

export const holdAppointmentSlotSchema = z.object({
  organisation_id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  appointment_type: appointmentTypeSchema,
  consultation_method: consultationMethodSchema,
  scheduled_for: z.string().refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value) > new Date(), {
    message: "Choose a time in the future",
  }),
  ends_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid end time" }),
  reason: z.string().trim().max(500).optional(),
  location: z.string().trim().max(200).optional(),
});
export type HoldAppointmentSlotInput = z.infer<typeof holdAppointmentSlotSchema>;

export const cancelAppointmentSchema = z.object({
  appointment_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  appointment_id: z.string().uuid(),
  new_scheduled_for: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)) && new Date(value) > new Date(),
    { message: "Choose a time in the future" }
  ),
  new_ends_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid end time" }),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const availabilityRuleSchema = z
  .object({
    organisation_id: z.string().uuid(),
    clinician_id: z.string().uuid(),
    day_of_week: z.number().int().min(0).max(6),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
    consultation_method: consultationMethodSchema,
    appointment_types: z.array(appointmentTypeSchema).min(1, "Pick at least one appointment type"),
    slot_duration_minutes: z.number().int().min(5).max(240),
    buffer_minutes: z.number().int().min(0).max(120),
    location: z.string().trim().max(200).optional(),
  })
  .refine((rule) => rule.end_time > rule.start_time, {
    message: "End time must be after start time",
    path: ["end_time"],
  });
export type AvailabilityRuleInput = z.infer<typeof availabilityRuleSchema>;

export const providerTimeOffSchema = z
  .object({
    organisation_id: z.string().uuid(),
    clinician_id: z.string().uuid(),
    kind: z.enum(["leave", "blocked"]),
    starts_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid start time" }),
    ends_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid end time" }),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((row) => new Date(row.ends_at) > new Date(row.starts_at), {
    message: "End must be after start",
    path: ["ends_at"],
  });
export type ProviderTimeOffInput = z.infer<typeof providerTimeOffSchema>;

export const joinWaitingListSchema = z.object({
  organisation_id: z.string().uuid(),
  appointment_type: appointmentTypeSchema,
  clinician_id: z.string().uuid().optional(),
  consultation_method: consultationMethodSchema.optional(),
  preferred_from: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid start" }),
  preferred_until: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid end" }),
});
export type JoinWaitingListInput = z.infer<typeof joinWaitingListSchema>;
