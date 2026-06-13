-- Migration 283 — Member Profiles and Member Guardians
-- Membership V2 Phase 1: person-owned accounts + household graph
-- Born RLS-on, REVOKE-ALL, no policies — all access via SECURITY DEFINER RPCs.
-- Zero touch to casual players / teams / their RLS wall.

-- ─── MEMBER PROFILES ─────────────────────────────────────────────────────────
-- The person: source of truth for PII, role-agnostic.
-- auth_user_id = NULL  → unclaimed (venue-created record).
-- auth_user_id = <uid> → claimed by the member (set via member_claim_profile).
-- source_customer_id   → back-compat pointer to venue_customers during migration.

CREATE TABLE IF NOT EXISTS public.member_profiles (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id                  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name                    text        NOT NULL,
  last_name                     text,
  email                         text,
  phone                         text,
  dob                           date,
  gender                        text,
  -- Address
  address_line1                 text,
  address_line2                 text,
  address_city                  text,
  address_postcode              text,
  -- CPSU: primary emergency contact
  ec1_name                      text,
  ec1_relationship              text,
  ec1_phone                     text,
  -- CPSU: second emergency contact (CPSU mandates two)
  ec2_name                      text,
  ec2_relationship              text,
  ec2_phone                     text,
  -- CPSU: additional needs
  send_notes                    text,       -- SEND / disability / additional needs + adjustments
  dietary_notes                 text,
  -- CPSU: consents (parent grants on behalf of child; adult self-grants)
  consent_emergency_treatment   boolean     NOT NULL DEFAULT false,
  consent_administer_medication boolean     NOT NULL DEFAULT false,
  may_leave_unaccompanied       boolean     NOT NULL DEFAULT false,
  authorised_collectors         text,       -- free text v1; Phase 6 may structure
  -- Medical / special-category data (access must be audit-logged per Hard Rule 9)
  medical_conditions            text,
  allergies                     text,
  medications                   text,
  gp_details                    text,
  -- Photo consent: granular per use (CPSU + UK GDPR standard)
  -- Shape: {"website": bool, "social": bool, "press": bool, "marketing": bool}
  photo_consent                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Back-compat: pointer to originating venue_customers row
  -- NULL for guardian-only profiles with no venue_customers counterpart
  source_customer_id            uuid        REFERENCES public.venue_customers(id) ON DELETE SET NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_profiles FROM anon, authenticated;

-- ─── MEMBER GUARDIANS ────────────────────────────────────────────────────────
-- Household graph: one parent → many children; many guardians → one child.
-- invite_state tracks the second-guardian invite flow (Phase 3).
-- A directly-created guardian (backfill, Phase 1 admin creation) lands 'accepted'.

CREATE TABLE IF NOT EXISTS public.member_guardians (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  child_profile_id    uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  guardian_profile_id uuid        NOT NULL REFERENCES public.member_profiles(id) ON DELETE CASCADE,
  relationship        text,                   -- 'parent', 'grandparent', 'carer', etc.
  is_primary          boolean     NOT NULL DEFAULT false,
  can_collect         boolean     NOT NULL DEFAULT false,
  invite_state        text        NOT NULL DEFAULT 'accepted'
                      CHECK (invite_state IN ('pending','accepted','declined')),
  invited_at          timestamptz,
  accepted_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_guardian_child UNIQUE (child_profile_id, guardian_profile_id)
);

ALTER TABLE public.member_guardians ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_guardians FROM anon, authenticated;
