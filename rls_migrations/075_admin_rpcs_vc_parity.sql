-- 075_admin_rpcs_vc_parity.sql
--
-- Blanket sweep: every admin_* RPC now accepts either the team's
-- admin_token OR a Vice Captain's player_token via the
-- resolve_admin_caller helper from migration 074. This delivers the
-- product rule: VCs hold full owner-grade authority on the admin
-- surface. The only distinction surfaces in audit_events.
--
-- HOW THE SWEEP WORKS
-- -------------------
-- The migration is a single PL/pgSQL transaction that, for each
-- existing admin_* function (except admin_set_vice_captain):
--
--   1. Captures the live function definition via pg_get_functiondef.
--   2. Injects `v_actor_type text;` and `v_actor_ident text;` into
--      the DECLARE block if not already present.
--   3. Replaces the resolver block:
--        SELECT id INTO v_team_id FROM teams WHERE admin_token = p_admin_token;
--        IF v_team_id IS NULL THEN RAISE invalid_admin_token; END IF;
--      with:
--        SELECT r.team_id, r.actor_type, r.actor_ident
--          INTO v_team_id, v_actor_type, v_actor_ident
--          FROM resolve_admin_caller(p_admin_token) r;
--        IF v_team_id IS NULL THEN RAISE invalid_admin_token; END IF;
--   4. Replaces the audit_events literals:
--        'team_admin'                        → v_actor_type
--        'admin_token:' || md5(p_admin_token) → v_actor_ident
--   5. EXECUTEs the rewritten CREATE OR REPLACE.
--
-- A final guard at the bottom raises (and rolls everything back) if
-- any admin_* RPC besides admin_set_vice_captain still lacks a
-- reference to resolve_admin_caller. Confirmed clean on apply.
--
-- WHAT IS PRESERVED
-- -----------------
-- Signatures, parameter names, return shapes, error codes,
-- per-RPC business logic, schedule lookups, guest guards. No JS
-- wrapper or React component is touched. Owner-driven calls produce
-- byte-identical audit rows.
--
-- admin_set_vice_captain is deliberately excluded: it has the dual
-- token fallback plus an auth.uid() NULL-token branch that this
-- helper does not subsume. Leaving it untouched preserves the
-- session-44 (token-path) and parallel-cloud (auth.uid()) fixes.

DO $sweep$
DECLARE
  r record;
  v_def text;
  v_new text;
  v_count int := 0;
  v_unchanged_names text := '';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'admin\_%' ESCAPE '\'
      AND p.proname NOT IN ('admin_set_vice_captain')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;

    IF v_new !~ 'v_actor_type' THEN
      v_new := regexp_replace(v_new, '(DECLARE\s*\n)', E'\\1  v_actor_type text;\n  v_actor_ident text;\n', '');
    END IF;

    v_new := regexp_replace(
      v_new,
      'SELECT\s+id\s+INTO\s+v_team_id\s+FROM\s+teams\s+WHERE\s+admin_token\s*=\s*p_admin_token\s*;\s*IF\s+v_team_id\s+IS\s+NULL\s+THEN\s*RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*''P0001''\s*,\s*MESSAGE\s*=\s*''invalid_admin_token''\s*;\s*END\s+IF\s*;',
      E'SELECT r.team_id, r.actor_type, r.actor_ident\n    INTO v_team_id, v_actor_type, v_actor_ident\n    FROM resolve_admin_caller(p_admin_token) r;\n  IF v_team_id IS NULL THEN\n    RAISE EXCEPTION USING ERRCODE=''P0001'', MESSAGE=''invalid_admin_token'';\n  END IF;',
      ''
    );

    v_new := regexp_replace(v_new, '''team_admin''(?=\s*,)', 'v_actor_type', 'g');
    v_new := regexp_replace(v_new, '''admin_token:''\s*\|\|\s*md5\(\s*p_admin_token\s*\)', 'v_actor_ident', 'g');

    IF v_new = v_def THEN
      v_unchanged_names := v_unchanged_names || r.proname || ' ';
    ELSE
      EXECUTE v_new;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Rewrote % admin RPCs; unchanged: %', v_count, COALESCE(NULLIF(v_unchanged_names, ''), '(none)');

  IF EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname LIKE 'admin\_%' ESCAPE '\'
      AND p.proname <> 'admin_set_vice_captain'
      AND pg_get_functiondef(p.oid) NOT LIKE '%resolve_admin_caller%'
  ) THEN
    RAISE EXCEPTION 'Some admin RPCs were not rewritten to use resolve_admin_caller — aborting';
  END IF;
END $sweep$;
