-- =============================================================================
-- Enable Row-Level Security on every public-schema table and add tenant-scoped
-- policies for the Supabase 'authenticated' role.
--
-- Context
-- -------
-- This migration originated from a Supabase `rls_disabled_in_public` linter
-- alert on 2026-05-25. Tables created by `prisma db push` against a fresh
-- Supabase database have RLS off by default; the linter flags every such
-- table as "publicly accessible" because anyone with the project URL + anon
-- key would be able to read or write through PostgREST.
--
-- Auth-model assumption
-- ---------------------
-- voice-agent talks to its database exclusively through Prisma using the
-- 'postgres' role (which has rolbypassrls=true). It does NOT use the
-- @supabase/supabase-js client and there is no Clerk -> Supabase JWT
-- bridging configured today. That means right now, the only role that ever
-- queries these tables is 'postgres', which bypasses RLS — so this
-- migration is invisible to the running app.
--
-- The policies below are written for the day Clerk-Supabase JWT bridging
-- IS configured (e.g. for a public booking page, a Supabase realtime
-- subscription, or a CMS-style read endpoint). They expect Clerk's JWT to
-- be re-signed with the Supabase project's JWT secret and to carry an
-- `org_id` custom claim that matches `Organization.id`. Until that
-- bridging is wired, the 'authenticated' role can have grants, but no rows
-- are visible without a valid org_id claim. The bridging step is documented
-- as a follow-up in SECURITY.md and the incident report.
--
-- DO NOT change the connection role from 'postgres' without re-auditing
-- every policy here. If Prisma ever connects as 'authenticated' or
-- 'service_role', the assumptions break.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: resolve the current request's tenant org from the JWT claim.
-- Returns NULL when the claim is absent (e.g. for `anon`), which makes every
-- tenant-scoped policy below evaluate to false, denying access by default.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(
    coalesce(
      current_setting('request.jwt.claim.org_id', true),
      current_setting('request.jwt.claims', true)::jsonb->>'org_id'
    ),
    ''
  );
$$;
COMMENT ON FUNCTION app.current_org_id() IS
  'Resolves the current request''s tenant org from the JWT claim. Returns NULL when no JWT or no claim, which collapses every tenant-scoped policy to "no rows".';

-- ---------------------------------------------------------------------------
-- Enable RLS on every public-schema table (idempotent; safe to re-run).
-- The deny-all stance from the 2026-05-25 hotfix stays in effect for any
-- table NOT covered by a policy below.
-- ---------------------------------------------------------------------------
ALTER TABLE public."AgentConfig"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentToolConfig"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Appointment"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Approval"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AutoApproveRule"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BillingSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BlockedNumber"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Call"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CallAction"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Contact"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CostEntry"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."KnowledgeDoc"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Memory"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Organization"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StripeWebhookEvent"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UsageEvent"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserMembership"      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Grants. Reset direct Supabase role access first, then grant the minimum
-- needed for future Clerk-Supabase clients. Billing-trusted tables are read-only
-- for authenticated clients. Only server-side Prisma/webhook code may mutate
-- Organization.subscriptionStatus, BillingSubscription, or UsageEvent rows.
-- `anon` deliberately gets NO grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON
  public."AgentConfig",
  public."AgentToolConfig",
  public."Appointment",
  public."Approval",
  public."AutoApproveRule",
  public."BillingSubscription",
  public."BlockedNumber",
  public."Call",
  public."CallAction",
  public."Contact",
  public."CostEntry",
  public."KnowledgeDoc",
  public."Memory",
  public."Notification",
  public."Organization",
  public."StripeWebhookEvent",
  public."UsageEvent",
  public."UserMembership"
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public."AgentConfig",
  public."AgentToolConfig",
  public."Appointment",
  public."Approval",
  public."AutoApproveRule",
  public."BlockedNumber",
  public."Call",
  public."CallAction",
  public."Contact",
  public."CostEntry",
  public."KnowledgeDoc",
  public."Memory",
  public."Notification",
  public."UserMembership"
TO authenticated;

GRANT SELECT ON
  public."BillingSubscription",
  public."Organization",
  public."UsageEvent"
TO authenticated;
-- StripeWebhookEvent stays grant-less for authenticated. Only the webhook
-- handler (running as postgres / service_role) writes to it; nothing in the
-- 'authenticated' path has a legitimate reason to touch it.

-- ---------------------------------------------------------------------------
-- Policies
--
-- Pattern A — tenant-scoped: a row's `orgId` must equal the JWT's org_id.
-- Pattern B — Organization itself: keyed by `id`, not `orgId`, so the policy
--   matches `id`.
-- Pattern C — UserMembership: tenant-scoped on `orgId`. Could be tightened
--   further to "only your own membership rows" via clerkUserId, but org-level
--   visibility is the canonical pattern for this kind of join table.
-- Pattern D — join-only tables (Memory, CallAction): no orgId column.
--   Reach the org via the parent (Contact, Call).
-- Pattern E — singleton/global (AgentConfig): readable by any authenticated
--   user (it holds the agent's voice/persona config; no PII). Writes still
--   require the bypass role.
-- Pattern F — operational (StripeWebhookEvent): no policy — denied for
--   authenticated regardless. Already had no grants, so doubly safe.
-- ---------------------------------------------------------------------------

-- Idempotency: drop our own policy names and any pre-existing deny-all policy
-- that's RESTRICTIVE (e.g. `deny_direct_supabase_client_access`). A RESTRICTIVE
-- policy with qual=false applied to {anon, authenticated} short-circuits every
-- permissive policy below to false for authenticated (RESTRICTIVE policies are
-- AND'd into the visibility check). Anon stays denied without it because it
-- still has zero grants on these tables.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_can_see_own_org" ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_via_parent_contact" ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_via_parent_call" ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_can_read_global_agent_config" ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "deny_direct_supabase_client_access" ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "anon_is_always_denied" ON public.%I', r.tablename);
  END LOOP;
END$$;

-- Replacement deny policy: keep the restrictive deny but scope it to `anon`
-- only. This preserves the explicit "anon is denied" intent without breaking
-- the authenticated path.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format(
      'CREATE POLICY "anon_is_always_denied" ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)',
      r.tablename
    );
  END LOOP;
END$$;

-- A — tenant-scoped tables (orgId column)
CREATE POLICY "authenticated_can_see_own_org" ON public."Contact"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."Call"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."Approval"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."CostEntry"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."AgentToolConfig"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."AutoApproveRule"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."KnowledgeDoc"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."Appointment"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."BlockedNumber"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."Notification"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());
-- Billing-trusted ledgers are read-only to authenticated clients. Server-side
-- Prisma/webhook code is the only writer because hosted usage gates trust them.
CREATE POLICY "authenticated_can_see_own_org" ON public."BillingSubscription"
  FOR SELECT TO authenticated
  USING      ("orgId" = app.current_org_id());
CREATE POLICY "authenticated_can_see_own_org" ON public."UsageEvent"
  FOR SELECT TO authenticated
  USING      ("orgId" = app.current_org_id());

-- C — UserMembership (orgId-scoped; could tighten to clerkUserId later)
CREATE POLICY "authenticated_can_see_own_org" ON public."UserMembership"
  FOR ALL TO authenticated
  USING      ("orgId" = app.current_org_id())
  WITH CHECK ("orgId" = app.current_org_id());

-- B — Organization (keyed by id, not orgId). Read-only to authenticated clients
-- because subscriptionStatus and quota fields are billing-trusted server state.
CREATE POLICY "authenticated_can_see_own_org" ON public."Organization"
  FOR SELECT TO authenticated
  USING      ("id" = app.current_org_id());

-- D — Memory: scoped through Contact
CREATE POLICY "authenticated_via_parent_contact" ON public."Memory"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."Contact" c
    WHERE c.id = "Memory"."contactId"
      AND c."orgId" = app.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Contact" c
    WHERE c.id = "Memory"."contactId"
      AND c."orgId" = app.current_org_id()
  ));

-- D — CallAction: scoped through Call
CREATE POLICY "authenticated_via_parent_call" ON public."CallAction"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."Call" c
    WHERE c.id = "CallAction"."callId"
      AND c."orgId" = app.current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Call" c
    WHERE c.id = "CallAction"."callId"
      AND c."orgId" = app.current_org_id()
  ));

-- E — AgentConfig singleton: readable by every authenticated user, no writes
CREATE POLICY "authenticated_can_read_global_agent_config" ON public."AgentConfig"
  FOR SELECT TO authenticated
  USING (true);

-- F — StripeWebhookEvent: deliberately no policy. authenticated has no grant
-- either, so any path attempting access is denied at the grant layer. Only
-- the webhook handler (running as service_role or postgres) writes here.

-- ---------------------------------------------------------------------------
-- Verification queries (run manually to confirm state):
--
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
--   SELECT schemaname, tablename, policyname, roles, cmd
--     FROM pg_policies WHERE schemaname='public' ORDER BY tablename;
--
-- Smoke tests under each role (in a transaction):
--
--   BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM public."Organization";          -- expect: permission denied
--   ROLLBACK;
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   -- without an org_id claim, app.current_org_id() returns NULL, so:
--   SELECT count(*) FROM public."Organization";          -- expect: 0
--   -- with a claim:
--   SET LOCAL "request.jwt.claim.org_id" = '<your-org-id>';
--   SELECT count(*) FROM public."Organization";          -- expect: 1
--   ROLLBACK;
--
--   SELECT count(*) FROM public."Organization";          -- as postgres: bypasses RLS, sees all
-- ---------------------------------------------------------------------------
