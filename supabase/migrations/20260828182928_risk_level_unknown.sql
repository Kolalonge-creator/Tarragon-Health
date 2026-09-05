-- Tarragon Health — Risk & Prevention Engine enhancement, 1/7
-- Add `unknown` to public.risk_level. Committed to git but never actually
-- applied to production — found while investigating a broader typecheck
-- failure. Content byte-identical to the committed
-- 20260827195909_risk_level_unknown.sql. Standalone migration on purpose:
-- PostgreSQL forbids using a newly added enum value inside the same
-- transaction that added it.

alter type public.risk_level add value 'unknown';
