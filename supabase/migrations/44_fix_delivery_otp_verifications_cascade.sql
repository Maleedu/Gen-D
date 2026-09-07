-- Backfill: this migration already exists live (applied via Supabase MCP as
-- version 20260907134857 / "fix_delivery_otp_verifications_cascade",
-- tracked in supabase_migrations.schema_migrations) but was never saved to
-- this folder until now. Statement below is copied verbatim from that
-- table, not reconstructed from schema introspection.
--
-- 43_add_delivery_otp_verification.sql's order_id FK was plain (no ON
-- DELETE behavior specified, which defaults to NO ACTION) — every sibling
-- table in this family (pickup_verifications, delivery_verifications,
-- delivery_photos) cascades on order delete. Brings this one in line.
ALTER TABLE public.delivery_otp_verifications
  DROP CONSTRAINT delivery_otp_verifications_order_id_fkey,
  ADD CONSTRAINT delivery_otp_verifications_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
