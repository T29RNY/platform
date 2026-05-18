-- Migration 001: Helper predicates for RLS policies + token generation utility.
--
-- Predicate helpers (is_team_member, etc.):
--   SECURITY DEFINER, STABLE, search_path locked to public.
--   Called exclusively by RLS policy USING/WITH CHECK expressions.
--   No direct grants needed — policies execute under definer's privileges.
--
-- Token generator (generate_url_safe_token):
--   VOLATILE (non-deterministic). No SECURITY DEFINER needed.
--   Called from inside SECURITY DEFINER RPCs (create_team, join_team_as_new_player).

-- ─────────────────────────────────────────────────────────────────────────────
-- is_team_member
-- Returns true if auth.uid() is linked to p_team_id either as a player
-- (team_players → players.user_id) or as an active admin (team_admins).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_team_member(p_team_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM   team_players tp
        JOIN   players p ON p.id = tp.player_id
        WHERE  tp.team_id = p_team_id
        AND    p.user_id  = auth.uid()
      )
      OR
      EXISTS (
        SELECT 1
        FROM   team_admins ta
        WHERE  ta.team_id    = p_team_id
        AND    ta.user_id    = auth.uid()
        AND    ta.revoked_at IS NULL
      )
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- shares_team_with_player
-- Returns true if auth.uid() is on at least one team in common with p_player_id.
-- Used by: player_career RLS (can I see this player's career stats?)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION shares_team_with_player(p_player_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM   team_players tp_them
      JOIN   team_players tp_me ON tp_me.team_id = tp_them.team_id
      JOIN   players      p_me  ON p_me.id        = tp_me.player_id
      WHERE  tp_them.player_id = p_player_id
      AND    p_me.user_id      = auth.uid()
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- shares_team_with_user
-- Returns true if auth.uid() is on at least one team in common with p_user_id.
-- Used by: user_profiles RLS (can I see this user's profile?)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION shares_team_with_user(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN
    auth.uid() IS NOT NULL
    AND p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM   team_players tp_them
      JOIN   players      p_them ON p_them.id      = tp_them.player_id
      JOIN   team_players tp_me  ON tp_me.team_id  = tp_them.team_id
      JOIN   players      p_me   ON p_me.id         = tp_me.player_id
      WHERE  p_them.user_id = p_user_id
      AND    p_me.user_id   = auth.uid()
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- is_my_player_id
-- Returns true if p_player_id is linked to auth.uid().
-- Used by: players RLS self-read, player_career RLS self-read.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_my_player_id(p_player_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM   players p
      WHERE  p.id      = p_player_id
      AND    p.user_id = auth.uid()
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- generate_url_safe_token
-- Generates a URL-safe random token with the given prefix.
-- Uses base64 encoding with '+', '/', '=' replaced by '-', '_', '' (deleted).
-- Result is RFC 4648 §5 (base64url) compatible and safe in URL path segments.
-- Default 12 bytes → 16 base64url characters of entropy (96 bits).
-- VOLATILE because gen_random_bytes() is non-deterministic.
-- Called from SECURITY DEFINER RPCs; no SECURITY DEFINER needed here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_url_safe_token(p_prefix text, p_bytes int DEFAULT 12)
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT p_prefix || translate(encode(gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
$$;