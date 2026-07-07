-- 497_get_tournament_reports.sql
-- UGC-moderation hardening (#2): the admin-facing moderation queue read RPC that
-- powers apps/superadmin's Moderation screen. Returns every tournament with >=1
-- report, aggregated: report counts by reason, total, latest report time, current
-- hidden state, and up to 5 recent reporter notes. Platform-admin only (gated by
-- is_platform_admin, same as admin_hide_tournament). Read-only.
CREATE OR REPLACE FUNCTION public.get_tournament_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'latest_report_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'tournament_id',    te.id,
        'slug',             te.slug,
        'name',             te.name,
        'status',           te.status,
        'hidden_at',        te.hidden_at,
        'hidden_reason',    te.hidden_reason,
        'venue_name',       v.name,
        'club_name',        c.name,
        'total_reports',    count(tr.id)::int,
        'latest_report_at', max(tr.created_at),
        'reasons', (
          SELECT jsonb_object_agg(reason, cnt)
          FROM (
            SELECT reason, count(*)::int AS cnt
            FROM public.tournament_reports
            WHERE tournament_event_id = te.id
            GROUP BY reason
          ) rc
        ),
        'recent_notes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('reason', reason, 'note', reporter_note, 'at', created_at) ORDER BY created_at DESC)
          FROM (
            SELECT reason, reporter_note, created_at
            FROM public.tournament_reports
            WHERE tournament_event_id = te.id AND reporter_note IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 5
          ) n
        ), '[]'::jsonb)
      ) AS row
      FROM public.tournament_events te
      JOIN public.tournament_reports tr ON tr.tournament_event_id = te.id
      LEFT JOIN public.venues v ON v.id = te.venue_id
      LEFT JOIN public.clubs  c ON c.id = te.club_id
      GROUP BY te.id, te.slug, te.name, te.status, te.hidden_at, te.hidden_reason, v.name, c.name
    ) rows
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tournament_reports() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tournament_reports() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_reports() TO authenticated;
