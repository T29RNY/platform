-- ============================================================
-- Migration 013 rollback: Admin match & schedule RPCs
-- ============================================================

DROP FUNCTION IF EXISTS admin_save_match_result(text,text,text,int,int,text,int,text[],text[],jsonb,text,text,text);
DROP FUNCTION IF EXISTS admin_save_teams(text,text,text[],text[],boolean);
DROP FUNCTION IF EXISTS admin_save_bib_holder(text,text,text);
DROP FUNCTION IF EXISTS admin_upsert_schedule(text,text,text,text,text,int,int,boolean,text,text,int,jsonb,text);
DROP FUNCTION IF EXISTS admin_upsert_settings(text,text);
DROP FUNCTION IF EXISTS admin_cancel_match(text,text);