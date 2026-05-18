-- ============================================================
-- Migration 015 rollback: Onboarding RPCs
-- ============================================================

DROP FUNCTION IF EXISTS join_team_as_returning_player(text, uuid);
DROP FUNCTION IF EXISTS create_team(text,text,text,text,text,text,int,int,boolean,text[],text,text,int);