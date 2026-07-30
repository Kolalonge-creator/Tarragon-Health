/**
 * Rail router, template registry, I1 enforcement (send() throws on a clinical template
 * routed to whatsapp/sms/email -- the DB CHECK constraints in the M1 migrations are the
 * second, independent enforcement point per spec §3/I1). Build spec v3 §9.
 *
 * Not yet built (M6). The notification_templates/notification_sends/notification_events/
 * device_heartbeats tables and their I1 CHECK constraints already exist live (M1) --
 * this package is the send() pipeline in front of them.
 */
export {};
