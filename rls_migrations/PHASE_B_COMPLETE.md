# Phase B Complete — Migration Design Summary

*Produced: 2026-05-18 (Session 24 continuation)*

All 20 migration files are designed. No SQL has been executed. Phase C is the execution phase.

---

## Migration inventory

| # | File | Description | Functions | Status |
|---|------|-------------|-----------|--------|
| 001 | `001_helpers.sql` | RLS predicate helpers + generate_url_safe_token | 5 helpers | ✅ Designed |
| 002 | `002_new_tables.sql` | team_admins + audit_events tables | — | ✅ Designed |
| 003 | `003_schema_additions.sql` | teams.live_channel_key + other column additions | — | ✅ Designed |
| 004 | `004_rls_enable.sql` | ENABLE ROW LEVEL SECURITY on all 17 tables | — | ✅ Designed |
| 005 | `005_views.sql` | teams_public, players_public, matches_public | 3 views | ✅ Designed |
| 006 | `006_rls_teams.sql` | RLS policies on teams | — | ✅ Designed |
| 007 | `007_rls_players.sql` | RLS policies on players + team_players | — | ✅ Designed |
| 008 | `008_rls_matches_schedule.sql` | RLS policies on matches, schedule, settings | — | ✅ Designed |
| 009 | `009_rls_payments_misc.sql` | RLS policies on all remaining tables | — | ✅ Designed |
| 010 | `010_rpcs_reads.sql` | Token-based + authenticated read RPCs | 7 RPCs | ✅ Designed |
| 011 | `011_rpcs_player_writes.sql` | Player write RPCs + notify_team_change helper | 11 RPCs | ✅ Designed |
| 012 | `012_rpcs_admin_players.sql` | Admin player management RPCs | 6 RPCs | ✅ Designed + Amended |
| 013 | `013_rpcs_admin_match.sql` | Admin match / schedule RPCs | 9 RPCs | ✅ Designed + Amended |
| 014 | `014_rpcs_admin_payments.sql` | Admin payment RPCs | 4 RPCs | ✅ Designed |
| 015 | `015_rpcs_onboarding.sql` | create_team + join_team_as_returning_player | 2 RPCs | ✅ Designed + Amended |
| 016 | `016_rpcs_potm.sql` | POTM RPCs | 3 RPCs | ✅ Designed |
| 017 | `017_broadcast_helper.sql` | Broadcast helper refinement (reason validation) | 1 RPC (refine) | ✅ **This session** |
| 018 | `018_rpcs_demo.sql` | update_demo_interaction | 1 RPC | ✅ **This session** |
| 019 | `019_grants_consolidation.sql` | Idempotent grant/revoke for all tables + RPCs | — | ✅ **This session** |
| 020 | `020_seed_backfill.sql` | live_channel_key backfill + team_admins seed | — | ✅ **This session** |

**Total RPCs designed: ~43** (35 in Phase A inventory + 8 Phase B additions/refinements)

---

## Open issues for Phase C

These must be resolved before or during Phase C execution.

| OI | Description | Blocking? | Resolution |
|----|-------------|-----------|------------|
| OI-51 | `settings_updated` not formally in §11.2 locked list | No — added to 017 v_known_reasons | Update RLS_PHASE_A.md §11.2 |
| OI-52 | payment_ledger CHECK constraints for `type='cancelled'` and `status='cancelled'` | **YES** — must apply before executing migration 013 | Add ALTER TABLE before 013 |
| OI-55 | player_career updates in admin_save_match_result deferred to Phase 2 | No — accepted limitation | Document; Phase 2 backlog |
| OI-56 | `player_enabled` in §11.2 — added via OI-45 in 012 | No — added to 017 v_known_reasons | Verify in §11.2 |
| OI-58 | Winner value `'D'` vs `'draw'` in DB — OI-19 normalises to 'D' | No — handled in 013 | Verify DB values during Phase C |
| OI-62 | `potm_voting_opened` — add to §11.2 | No — added to 017 v_known_reasons | Update RLS_PHASE_A.md §11.2 |
| OI-63 | `potm_result_announced` — add to §11.2 | No — added to 017 v_known_reasons | Update RLS_PHASE_A.md §11.2 |
| OI-64 | Cron potmVotingOpenJob uses service_role; no admin_token | No — service role bypasses RLS | Phase 2: dedicated cron RPC |
| OI-68 | settings.team_id UNIQUE constraint — verify before running 015 | Soft — create_team depends on it | Check constraint at Phase C kickoff |
| OI-69 | motm double-count (admin_close_potm_voting + admin_save_match_result) | No — accepted limitation | Phase 2: idempotency tracking |

**Hard blocker before executing migration 013:**
```sql
-- OI-52: Add cancelled type/status to payment_ledger CHECK constraints
-- Apply as first step of Phase C before migration 013 runs
ALTER TABLE payment_ledger
  DROP CONSTRAINT IF EXISTS payment_ledger_type_check,
  ADD  CONSTRAINT payment_ledger_type_check
    CHECK (type IN ('game_fee', 'debt', 'waiver', 'refund', 'cancelled'));

ALTER TABLE payment_ledger
  DROP CONSTRAINT IF EXISTS payment_ledger_status_check,
  ADD  CONSTRAINT payment_ledger_status_check
    CHECK (status IN ('pending', 'paid', 'waived', 'refunded', 'cancelled'));
```

---

## Phase C: Execution order

Run in numeric order. Each migration is idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

```
Phase C pre-flight
  └── OI-52: ALTER TABLE payment_ledger (CHECK constraints)
  └── Verify settings.team_id UNIQUE constraint (OI-68)
  └── Create team_audit test team + seeded data

001_helpers.sql
002_new_tables.sql
003_schema_additions.sql
004_rls_enable.sql
005_views.sql
006_rls_teams.sql
007_rls_players.sql
008_rls_matches_schedule.sql
009_rls_payments_misc.sql
010_rpcs_reads.sql
011_rpcs_player_writes.sql
012_rpcs_admin_players.sql        ← apply 012 amendments before running
013_rpcs_admin_match.sql          ← requires OI-52 constraint fix first
014_rpcs_admin_payments.sql
015_rpcs_onboarding.sql           ← apply 015 amendments before running
016_rpcs_potm.sql
017_broadcast_helper.sql
018_rpcs_demo.sql
019_grants_consolidation.sql      ← always last in the RPC chain
020_seed_backfill.sql             ← always last
```

---

## Phase C: Client refactor checklist

After migrations execute successfully, every Supabase table call in the JS layer must be replaced with the corresponding RPC call. Organised by migration.

### From migration 010 (read RPCs)
- [ ] Replace `supabase.from('teams').select(...)` with `get_team_by_admin_token` or `get_team_state_by_admin_token`
- [ ] Replace `supabase.from('players').select(...)` (player view) with `get_player_by_token`
- [ ] Replace `supabase.from('...')` bulk state load with `get_team_state_by_player_token` / `get_team_state_by_admin_token`
- [ ] Replace `supabase.from('teams').select(...)` join-page load with `get_team_by_join_code`
- [ ] Add realtime subscription to `team_live:<live_channel_key>` channel (key returned by token RPCs)

### From migration 011 (player writes)
- [ ] `supabase.from('players').update({ status })` → `set_player_status`
- [ ] `supabase.from('players').update({ paid, self_paid })` → `set_player_paid`
- [ ] `supabase.from('player_injuries')` mutations → `set_player_injured`
- [ ] Guest player add → `add_guest_player`
- [ ] Guest payment → `set_guest_payment`
- [ ] Cash payment entry → `player_create_cash_payment_entry`
- [ ] POTM vote → `cast_potm_vote`
- [ ] POTM own vote read → `get_my_potm_vote`
- [ ] Push subscription → `register_push_subscription` / `unregister_push_subscription`

### From migration 012 (admin player management)
- [ ] Admin add player → `admin_add_player`
- [ ] Admin delete player → `admin_delete_player`
- [ ] Admin set status → `admin_set_player_status`
- [ ] Admin set priority → `admin_set_player_priority`
- [ ] Admin toggle VC → `admin_toggle_vc`
- [ ] Admin disable/enable → `admin_disable_player`

### From migration 013 (admin match / schedule)
- [ ] Save match result (multi-step JS in `saveMatchResult`) → `admin_save_match_result`
- [ ] Save teams draft/confirm → `admin_save_teams`
- [ ] Save bib holder → `admin_save_bib_holder`
- [ ] Upsert schedule → `admin_upsert_schedule`
- [ ] Upsert settings → `admin_upsert_settings`
- [ ] Cover player add/remove/update → `admin_add_cover_player` / `admin_remove_cover_player` / `admin_update_cover_player`
- [ ] Cancel match (8-step JS flow in `bulkResetPlayerStatuses` + friends) → `admin_cancel_match`

### From migration 014 (admin payments)
- [ ] Confirm payment → `admin_confirm_payment`
- [ ] Reset payment → `admin_reset_payment`
- [ ] Clear debt → `admin_clear_debt`
- [ ] Waive debt → `admin_waive_debt`

### From migration 015 (onboarding)
- [ ] `useOnboarding.js` `submitTeam` + `submitPlayers` → single `create_team` call at step 3
- [ ] Join flow player creation → `join_team_as_returning_player`

### From migration 016 (POTM)
- [ ] Open POTM voting → `open_potm_voting`
- [ ] Close POTM voting → `admin_close_potm_voting`
- [ ] POTM tally (admin) → `get_potm_tally`

### From migration 018 (demo)
- [ ] `supabase.from('demo_sessions').update(...)` → `update_demo_interaction`

---

## Known Phase 1 limitations (accepted, documented)

| Limitation | Impact | Phase 2 fix |
|------------|--------|-------------|
| admin_save_match_result: W/L/D not corrected on re-save | Admin must cancel+re-enter to fix wrong result | Delta tracking in player_match |
| admin_save_bib_holder: repeated calls double-count bib_count | Bib count can drift if called twice | Idempotency check before increment |
| admin_close_potm_voting: motm set here AND via admin_save_match_result | Double-count if both flows used | Phase 2: single canonical motm path |
| player_career updates: entirely deferred | No career aggregates in Phase 1 | Phase 2: UPSERT career in admin_save_match_result |

---

Phase B complete. Ready for Phase C review and execution planning.
