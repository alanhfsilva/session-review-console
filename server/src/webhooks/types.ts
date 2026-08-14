import { z } from "zod";

/**
 * The contract this console publishes to the scheduling vendor. Everything
 * arriving on the webhook is untrusted until it parses cleanly against it.
 */
export const appointmentEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  type: z.enum(["appointment.created", "appointment.updated", "appointment.cancelled"]),
  occurredAt: z.string().min(1),
  appointment: z.object({
    id: z.string().min(1).max(200),
    status: z.enum(["scheduled", "rescheduled", "cancelled"]),
    clinicianEmail: z.string().email().nullable().optional(),
    scheduledAt: z.string().min(1).nullable().optional(),
    durationMinutes: z.number().int().positive().nullable().optional(),
    patientInitials: z.string().max(12).nullable().optional(),
    serviceType: z.string().max(120).nullable().optional(),
  }),
});

export type AppointmentEvent = z.infer<typeof appointmentEventSchema>;

export type HandleResult = "linked" | "unmatched" | "duplicate";
