# Migration 015 — Targeted Amendments

Two targeted diffs to apply to `015_rpcs_onboarding.sql` before execution.
Both affect the CREATE OR REPLACE body only — no signature changes.

---

## Amendment 1 — OI-67: team_admins ON CONFLICT

**Location:** `create_team`, Step 11 — team_admins INSERT (near end of function body)

**Find:**
```sql
INSERT INTO team_admins (team_id, user_id, role, granted_by)
VALUES (v_team_id, auth.uid(), 'team_admin', null)
ON CONFLICT (team_id, user_id) DO NOTHING;
```

**Replace with:**
```sql
INSERT INTO team_admins (team_id, user_id, role, granted_by)
VALUES (v_team_id, auth.uid(), 'team_admin', null)
ON CONFLICT DO NOTHING;  -- OI-67: no named UNIQUE constraint on (team_id, user_id, role WHERE revoked_at IS NULL)
```

**Why:** The partial unique index `team_admins_uniq_active` is on `(team_id, user_id, role) WHERE revoked_at IS NULL`.
`ON CONFLICT (team_id, user_id)` requires a plain UNIQUE constraint on exactly those two columns, which does not
exist. `ON CONFLICT DO NOTHING` catches any constraint violation without specifying the target.

---

## Amendment 2 — OI-70: join_team_as_returning_player auth.uid() spoof guard

**Location:** `join_team_as_returning_player`, after the team resolution + team-null check, before the
player_id resolution.

**Context — code block immediately before insertion point:**
```sql
  SELECT id INTO v_team_id FROM teams WHERE id = p_team_id;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'team_not_found';
  END IF;
```

**Insert immediately after that IF block:**
```sql
  -- OI-70: prevent authenticated callers from spoofing a different user_id
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forbidden';
  END IF;
```

**Why:** Without this guard an authenticated user can pass any UUID as `p_user_id` and link themselves
to another user's player record. The guard is auth.uid()-conditional so anon callers (where auth.uid()
is NULL) are unaffected.

---

## Verification after applying amendments

```sql
-- Spot-check: create_team team_admins INSERT uses ON CONFLICT DO NOTHING
\sf create_team

-- Spot-check: join_team_as_returning_player has forbidden guard
\sf join_team_as_returning_player
```
