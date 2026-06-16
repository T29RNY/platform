-- DOWN 345 — restore pre-Phase-8 hq_get_utilisation + hq_get_analytics; drop hq_get_class_insights.

DROP FUNCTION IF EXISTS public.hq_get_class_insights(text);

-- Restore hq_get_utilisation (pre-345: no `spaces` block / `spaces_definition`)
CREATE OR REPLACE FUNCTION public.hq_get_utilisation(p_company_id text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_from date; v_to date; v_days int;
  v_tz   text := 'Europe/London';
  v_result jsonb;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  v_from := COALESCE(p_date_from, current_date - 27);
  v_to   := COALESCE(p_date_to,   current_date);
  v_days := (v_to - v_from) + 1;

  WITH scoped AS (
    SELECT v.id, v.name, v.region, v.default_prime_time_windows
    FROM venues v
    WHERE v.company_id = p_company_id AND v.active = true
      AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
  ),
  pitches AS (
    SELECT pa.id AS pitch_id, pa.name AS pitch_name, pa.venue_id,
           sv.name AS venue_name, sv.region AS venue_region, pa.booking_windows,
           (jsonb_array_length(pa.booking_windows) = 0) AS assumed_avail,
           CASE WHEN jsonb_array_length(pa.prime_time_windows) > 0 THEN pa.prime_time_windows
                WHEN jsonb_array_length(sv.default_prime_time_windows) > 0 THEN sv.default_prime_time_windows
                ELSE NULL END AS prime_windows,
           CASE WHEN jsonb_array_length(pa.prime_time_windows) > 0 THEN 'pitch'
                WHEN jsonb_array_length(sv.default_prime_time_windows) > 0 THEN 'venue_default'
                ELSE 'not_configured' END AS prime_source
    FROM playing_areas pa JOIN scoped sv ON sv.id = pa.venue_id WHERE pa.active = true
  ),
  days AS (
    SELECT d::date AS day, extract(dow from d)::int AS dow
    FROM generate_series(v_from, v_to, interval '1 day') d
  ),
  eff_windows AS (
    SELECT p.pitch_id, (w->>'day_of_week')::int AS dow_w, (w->>'open_time')::time AS open_t, (w->>'close_time')::time AS close_t
    FROM pitches p CROSS JOIN LATERAL jsonb_array_elements(p.booking_windows) w WHERE NOT p.assumed_avail
    UNION ALL
    SELECT p.pitch_id, gs, '08:00'::time, '22:00'::time FROM pitches p CROSS JOIN generate_series(0,6) gs WHERE p.assumed_avail
  ),
  avail AS (
    SELECT p.pitch_id, p.venue_id, p.venue_name, p.venue_region, p.pitch_name, p.prime_source, p.assumed_avail, p.prime_windows, b AS bucket_ts
    FROM pitches p JOIN eff_windows ew ON ew.pitch_id = p.pitch_id JOIN days dd ON dd.dow = ew.dow_w
    CROSS JOIN LATERAL generate_series((dd.day + ew.open_t)::timestamp, (dd.day + ew.close_t)::timestamp - interval '30 minutes', interval '30 minutes') b
  ),
  avail_cls AS (
    SELECT a.*, CASE WHEN a.prime_windows IS NULL THEN NULL ELSE EXISTS (
        SELECT 1 FROM jsonb_array_elements(a.prime_windows) pw
        WHERE (pw->>'day_of_week')::int = extract(dow from a.bucket_ts)::int
          AND a.bucket_ts::time >= (pw->>'start_time')::time AND a.bucket_ts::time < (pw->>'end_time')::time) END AS is_prime
    FROM avail a
  ),
  occ AS (
    SELECT o.playing_area_id AS pitch_id, o.source_kind, b AS bucket_ts
    FROM pitch_occupancy o JOIN pitches p ON p.pitch_id = o.playing_area_id
    CROSS JOIN LATERAL generate_series((lower(o.time_range) AT TIME ZONE v_tz), (upper(o.time_range) AT TIME ZONE v_tz) - interval '30 minutes', interval '30 minutes') b
    WHERE o.active = true AND o.source_kind IN ('fixture','booking')
      AND (lower(o.time_range) AT TIME ZONE v_tz) < (v_to + 1)::timestamp AND (upper(o.time_range) AT TIME ZONE v_tz) > (v_from)::timestamp
  ),
  occ_agg AS (SELECT pitch_id, bucket_ts, max(source_kind) AS used_kind FROM occ GROUP BY pitch_id, bucket_ts),
  marked AS (SELECT ac.*, (oa.bucket_ts IS NOT NULL) AS used, oa.used_kind FROM avail_cls ac LEFT JOIN occ_agg oa ON oa.pitch_id = ac.pitch_id AND oa.bucket_ts = ac.bucket_ts),
  pitch_stats AS (
    SELECT pitch_id, venue_id, venue_name, venue_region, pitch_name, prime_source, bool_or(assumed_avail) AS assumed_avail,
           count(*)::numeric * 0.5 AS avail_h, count(*) FILTER (WHERE used)::numeric * 0.5 AS used_h,
           count(*) FILTER (WHERE is_prime)::numeric * 0.5 AS prime_avail_h, count(*) FILTER (WHERE is_prime AND used)::numeric * 0.5 AS prime_used_h,
           count(*) FILTER (WHERE is_prime = false)::numeric * 0.5 AS off_avail_h, count(*) FILTER (WHERE is_prime = false AND used)::numeric * 0.5 AS off_used_h,
           count(*) FILTER (WHERE used AND used_kind='fixture')::numeric * 0.5 AS fixture_h, count(*) FILTER (WHERE used AND used_kind='booking')::numeric * 0.5 AS booking_h
    FROM marked GROUP BY pitch_id, venue_id, venue_name, venue_region, pitch_name, prime_source
  ),
  venue_stats AS (
    SELECT venue_id, venue_name, venue_region, sum(avail_h) avail_h, sum(used_h) used_h, sum(prime_avail_h) prime_avail_h, sum(prime_used_h) prime_used_h,
           sum(off_avail_h) off_avail_h, sum(off_used_h) off_used_h, sum(fixture_h) fixture_h, sum(booking_h) booking_h,
           bool_or(prime_source <> 'not_configured') AS any_prime_configured
    FROM pitch_stats GROUP BY venue_id, venue_name, venue_region
  ),
  requested AS (
    SELECT b.playing_area_id AS pitch_id, b.venue_id, sum(COALESCE(b.slot_minutes, 60))::numeric / 60.0 AS req_h, count(*) AS req_n
    FROM pitch_bookings b JOIN scoped sv ON sv.id = b.venue_id
    WHERE b.status = 'requested' AND b.superseded_at IS NULL AND b.booking_date BETWEEN v_from AND v_to
    GROUP BY b.playing_area_id, b.venue_id
  ),
  dow_company AS (SELECT extract(dow from bucket_ts)::int AS dow, count(*) AS av, count(*) FILTER (WHERE used) AS us FROM marked GROUP BY 1),
  hour_company AS (SELECT extract(hour from bucket_ts)::int AS hr, count(*) AS av, count(*) FILTER (WHERE used) AS us FROM marked GROUP BY 1),
  dow_venue AS (SELECT venue_id, extract(dow from bucket_ts)::int AS dow, count(*) AS av, count(*) FILTER (WHERE used) AS us FROM marked GROUP BY 1, 2),
  hour_venue AS (SELECT venue_id, extract(hour from bucket_ts)::int AS hr, count(*) AS av, count(*) FILTER (WHERE used) AS us FROM marked GROUP BY 1, 2)
  SELECT jsonb_build_object(
    'range',  jsonb_build_object('from', v_from, 'to', v_to, 'days', v_days),
    'caller', jsonb_build_object('actor_type', v_actor, 'role', v_role, 'region', v_region),
    'assumptions', jsonb_build_object('bucket_minutes', 30, 'timezone', v_tz, 'assumed_availability_window', '08:00-22:00 all week',
       'assumed_pitches', (SELECT count(*) FROM pitches WHERE assumed_avail),
       'used_definition', 'fixtures + confirmed bookings, clipped to opening hours; maintenance excluded; requested shown separately'),
    'company', (SELECT jsonb_build_object(
        'available_hours', round(COALESCE(sum(avail_h),0), 1), 'used_hours', round(COALESCE(sum(used_h),0), 1),
        'overall_pct', CASE WHEN COALESCE(sum(avail_h),0) > 0 THEN round(100.0*sum(used_h)/sum(avail_h), 1) ELSE NULL END,
        'prime_configured', COALESCE(bool_or(any_prime_configured), false),
        'prime_available_hours', round(COALESCE(sum(prime_avail_h),0), 1), 'prime_used_hours', round(COALESCE(sum(prime_used_h),0), 1),
        'prime_pct', CASE WHEN COALESCE(sum(prime_avail_h),0) > 0 THEN round(100.0*sum(prime_used_h)/sum(prime_avail_h), 1) ELSE NULL END,
        'empty_prime_hours', round(COALESCE(sum(prime_avail_h)-sum(prime_used_h),0), 1),
        'offpeak_available_hours', round(COALESCE(sum(off_avail_h),0), 1), 'offpeak_used_hours', round(COALESCE(sum(off_used_h),0), 1),
        'offpeak_pct', CASE WHEN COALESCE(sum(off_avail_h),0) > 0 THEN round(100.0*sum(off_used_h)/sum(off_avail_h), 1) ELSE NULL END,
        'source_split', jsonb_build_object('fixture_hours', round(COALESCE(sum(fixture_h),0), 1), 'booking_hours', round(COALESCE(sum(booking_h),0), 1)),
        'requested_hours', (SELECT round(COALESCE(sum(req_h),0), 1) FROM requested), 'requested_count', (SELECT COALESCE(sum(req_n),0)::int FROM requested),
        'best_day',  (SELECT jsonb_build_object('day', (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[dow+1], 'pct', round(100.0*us/av, 1)) FROM dow_company WHERE av > 0 ORDER BY us::numeric/av DESC, dow LIMIT 1),
        'worst_day', (SELECT jsonb_build_object('day', (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[dow+1], 'pct', round(100.0*us/av, 1)) FROM dow_company WHERE av > 0 ORDER BY us::numeric/av ASC,  dow LIMIT 1),
        'best_slot',  (SELECT jsonb_build_object('slot', lpad(hr::text,2,'0')||':00', 'pct', round(100.0*us/av, 1)) FROM hour_company WHERE av > 0 ORDER BY us::numeric/av DESC, hr LIMIT 1),
        'worst_slot', (SELECT jsonb_build_object('slot', lpad(hr::text,2,'0')||':00', 'pct', round(100.0*us/av, 1)) FROM hour_company WHERE av > 0 ORDER BY us::numeric/av ASC,  hr LIMIT 1)
      ) FROM venue_stats),
    'venues', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'venue_id', vs.venue_id, 'venue_name', vs.venue_name, 'region', vs.venue_region,
        'available_hours', round(vs.avail_h, 1), 'used_hours', round(vs.used_h, 1),
        'overall_pct', CASE WHEN vs.avail_h > 0 THEN round(100.0*vs.used_h/vs.avail_h, 1) ELSE NULL END,
        'prime_configured', vs.any_prime_configured, 'prime_available_hours', round(vs.prime_avail_h, 1), 'prime_used_hours', round(vs.prime_used_h, 1),
        'prime_pct', CASE WHEN vs.prime_avail_h > 0 THEN round(100.0*vs.prime_used_h/vs.prime_avail_h, 1) ELSE NULL END,
        'empty_prime_hours', round(vs.prime_avail_h - vs.prime_used_h, 1),
        'offpeak_available_hours', round(vs.off_avail_h, 1), 'offpeak_used_hours', round(vs.off_used_h, 1),
        'offpeak_pct', CASE WHEN vs.off_avail_h > 0 THEN round(100.0*vs.off_used_h/vs.off_avail_h, 1) ELSE NULL END,
        'source_split', jsonb_build_object('fixture_hours', round(vs.fixture_h, 1), 'booking_hours', round(vs.booking_h, 1)),
        'requested_hours', (SELECT round(COALESCE(sum(req_h),0), 1) FROM requested r WHERE r.venue_id = vs.venue_id),
        'best_day',  (SELECT jsonb_build_object('day', (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[dv.dow+1], 'pct', round(100.0*dv.us/dv.av, 1)) FROM dow_venue dv WHERE dv.venue_id = vs.venue_id AND dv.av > 0 ORDER BY dv.us::numeric/dv.av DESC, dv.dow LIMIT 1),
        'worst_day', (SELECT jsonb_build_object('day', (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[dv.dow+1], 'pct', round(100.0*dv.us/dv.av, 1)) FROM dow_venue dv WHERE dv.venue_id = vs.venue_id AND dv.av > 0 ORDER BY dv.us::numeric/dv.av ASC,  dv.dow LIMIT 1),
        'best_slot',  (SELECT jsonb_build_object('slot', lpad(hv.hr::text,2,'0')||':00', 'pct', round(100.0*hv.us/hv.av, 1)) FROM hour_venue hv WHERE hv.venue_id = vs.venue_id AND hv.av > 0 ORDER BY hv.us::numeric/hv.av DESC, hv.hr LIMIT 1),
        'worst_slot', (SELECT jsonb_build_object('slot', lpad(hv.hr::text,2,'0')||':00', 'pct', round(100.0*hv.us/hv.av, 1)) FROM hour_venue hv WHERE hv.venue_id = vs.venue_id AND hv.av > 0 ORDER BY hv.us::numeric/hv.av ASC,  hv.hr LIMIT 1),
        'pitches', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'pitch_id', ps.pitch_id, 'pitch_name', ps.pitch_name, 'prime_source', ps.prime_source, 'assumed_availability', ps.assumed_avail,
            'available_hours', round(ps.avail_h, 1), 'used_hours', round(ps.used_h, 1),
            'overall_pct', CASE WHEN ps.avail_h > 0 THEN round(100.0*ps.used_h/ps.avail_h, 1) ELSE NULL END,
            'prime_pct', CASE WHEN ps.prime_source <> 'not_configured' AND ps.prime_avail_h > 0 THEN round(100.0*ps.prime_used_h/ps.prime_avail_h, 1) ELSE NULL END,
            'empty_prime_hours', CASE WHEN ps.prime_source <> 'not_configured' THEN round(ps.prime_avail_h - ps.prime_used_h, 1) ELSE NULL END,
            'offpeak_pct', CASE WHEN ps.prime_source <> 'not_configured' AND ps.off_avail_h > 0 THEN round(100.0*ps.off_used_h/ps.off_avail_h, 1) ELSE NULL END,
            'source_split', jsonb_build_object('fixture_hours', round(ps.fixture_h, 1), 'booking_hours', round(ps.booking_h, 1))
          ) ORDER BY ps.pitch_name), '[]'::jsonb) FROM pitch_stats ps WHERE ps.venue_id = vs.venue_id)
      ) ORDER BY vs.venue_name), '[]'::jsonb) FROM venue_stats vs)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- Restore hq_get_analytics (pre-345: no `classes` block)
CREATE OR REPLACE FUNCTION public.hq_get_analytics(p_company_id text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id text; v_actor text; v_role text; v_region text;
  v_config jsonb; v_result jsonb;
BEGIN
  SELECT rc.company_id, rc.actor_type, rc.role, rc.region
    INTO v_company_id, v_actor, v_role, v_region
    FROM public.resolve_company_caller(p_company_id) rc;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT dashboard_config INTO v_config FROM company_admins WHERE user_id = auth.uid() AND company_id = p_company_id;

  WITH scoped AS (
    SELECT v.id, v.name, v.region, v.subscription_status, v.trial_ends_at FROM venues v
    WHERE v.company_id = p_company_id AND (v_role <> 'regional_admin' OR v.region IS NOT DISTINCT FROM v_region)
  ),
  fx AS (
    SELECT f.id, f.status, f.home_score, f.away_score, f.scheduled_date, sv.id AS venue_id, sv.name AS venue_name
    FROM fixtures f JOIN competitions cp ON cp.id = f.competition_id JOIN seasons se ON se.id = cp.season_id
    JOIN leagues l ON l.id = se.league_id JOIN scoped sv ON sv.id = l.venue_id
    WHERE (p_date_from IS NULL OR f.scheduled_date >= p_date_from) AND (p_date_to IS NULL OR f.scheduled_date <= p_date_to)
  ),
  ev AS (SELECT me.event_type, me.player_id, me.player_name_override, me.team_id, fx.venue_name FROM match_events me JOIN fx ON fx.id = me.fixture_id),
  chg AS (
    SELECT c.venue_id, c.amount_due_pence,
           COALESCE((SELECT SUM(CASE WHEN p.kind = 'payment' THEN p.amount_pence ELSE -p.amount_pence END) FROM venue_payments p WHERE p.charge_id = c.id AND p.voided_at IS NULL), 0) AS paid
    FROM venue_charges c JOIN scoped sv ON sv.id = c.venue_id
    WHERE c.status <> 'refunded' AND (p_date_from IS NULL OR c.created_at::date >= p_date_from) AND (p_date_to IS NULL OR c.created_at::date <= p_date_to)
  )
  SELECT jsonb_build_object(
    'overview', jsonb_build_object(
      'venues', (SELECT count(*) FROM scoped),
      'active_leagues', (SELECT count(*) FROM leagues l WHERE l.venue_id IN (SELECT id FROM scoped) AND l.active),
      'active_seasons', (SELECT count(*) FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.venue_id IN (SELECT id FROM scoped) AND s.status='active'),
      'registered_teams', (SELECT count(DISTINCT ct.team_id) FROM competition_teams ct JOIN competitions cp ON cp.id=ct.competition_id JOIN seasons se ON se.id=cp.season_id JOIN leagues l ON l.id=se.league_id WHERE l.venue_id IN (SELECT id FROM scoped)),
      'fixtures_completed', (SELECT count(*) FROM fx WHERE status='completed'),
      'fixtures_remaining', (SELECT count(*) FROM fx WHERE status IN ('scheduled','allocated','in_progress','postponed')),
      'total_goals', (SELECT COALESCE(sum(COALESCE(home_score,0)+COALESCE(away_score,0)),0) FROM fx WHERE status='completed'),
      'avg_goals_per_game', (SELECT CASE WHEN count(*) FILTER (WHERE status='completed')=0 THEN 0 ELSE round(COALESCE(sum(COALESCE(home_score,0)+COALESCE(away_score,0)) FILTER (WHERE status='completed'),0)::numeric / count(*) FILTER (WHERE status='completed'), 2) END FROM fx)
    ),
    'venue_comparison', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'venue', sv.name, 'region', sv.region,
        'leagues', (SELECT count(*) FROM leagues l WHERE l.venue_id=sv.id),
        'teams', (SELECT count(DISTINCT ct.team_id) FROM competition_teams ct JOIN competitions cp ON cp.id=ct.competition_id JOIN seasons se ON se.id=cp.season_id JOIN leagues l ON l.id=se.league_id WHERE l.venue_id=sv.id),
        'fixtures_completed', (SELECT count(*) FROM fx WHERE fx.venue_id=sv.id AND fx.status='completed'),
        'fixtures_total', (SELECT count(*) FROM fx WHERE fx.venue_id=sv.id),
        'completion_pct', (SELECT CASE WHEN count(*)=0 THEN NULL ELSE round(100.0*count(*) FILTER (WHERE status='completed')/count(*),0) END FROM fx WHERE fx.venue_id=sv.id),
        'open_incidents', (SELECT count(*) FROM incidents i WHERE i.venue_id=sv.id AND i.resolved_at IS NULL)
      ) ORDER BY sv.name), '[]'::jsonb) FROM scoped sv),
    'top_scorers', (SELECT COALESCE(jsonb_agg(row_to_json(ts)), '[]'::jsonb) FROM (
        SELECT COALESCE(p.name, ev.player_name_override, 'Unknown') AS player, t.name AS team, ev.venue_name AS venue, count(*) AS goals
        FROM ev LEFT JOIN players p ON p.id = ev.player_id LEFT JOIN teams t ON t.id = ev.team_id WHERE ev.event_type='goal'
        GROUP BY COALESCE(p.name, ev.player_name_override, 'Unknown'), t.name, ev.venue_name ORDER BY count(*) DESC, player ASC LIMIT 15) ts),
    'discipline', (SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb) FROM (
        SELECT COALESCE(p.name, ev.player_name_override, 'Unknown') AS player, t.name AS team,
               count(*) FILTER (WHERE ev.event_type='yellow_card') AS yellows, count(*) FILTER (WHERE ev.event_type='red_card') AS reds
        FROM ev LEFT JOIN players p ON p.id = ev.player_id LEFT JOIN teams t ON t.id = ev.team_id WHERE ev.event_type IN ('yellow_card','red_card')
        GROUP BY COALESCE(p.name, ev.player_name_override, 'Unknown'), t.name
        ORDER BY (count(*) FILTER (WHERE ev.event_type='red_card')) DESC, (count(*) FILTER (WHERE ev.event_type='yellow_card')) DESC LIMIT 15) d),
    'incidents', jsonb_build_object(
      'critical', (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL AND i.severity='critical'),
      'warning', (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL AND i.severity='warning'),
      'info', (SELECT count(*) FROM incidents i WHERE i.venue_id IN (SELECT id FROM scoped) AND i.resolved_at IS NULL AND i.severity='info')),
    'billing', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT subscription_status AS status, count(*) AS n FROM scoped GROUP BY subscription_status) b),
    'revenue', jsonb_build_object(
      'owed_pence', (SELECT COALESCE(SUM(amount_due_pence),0) FROM chg),
      'collected_pence', (SELECT COALESCE(SUM(paid),0) FROM chg),
      'outstanding_pence', (SELECT COALESCE(SUM(GREATEST(amount_due_pence - paid, 0)),0) FROM chg),
      'collection_rate', (SELECT CASE WHEN COALESCE(SUM(amount_due_pence),0)=0 THEN NULL ELSE round(100.0 * SUM(paid) / SUM(amount_due_pence), 1) END FROM chg),
      'by_venue', (SELECT COALESCE(jsonb_agg(jsonb_build_object('venue', sv.name, 'region', sv.region, 'owed_pence', x.owed, 'collected_pence', x.collected, 'outstanding_pence', x.outstanding, 'collection_rate', x.rate) ORDER BY sv.name), '[]'::jsonb)
        FROM scoped sv CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(amount_due_pence),0) AS owed, COALESCE(SUM(paid),0) AS collected, COALESCE(SUM(GREATEST(amount_due_pence - paid, 0)),0) AS outstanding,
                 CASE WHEN COALESCE(SUM(amount_due_pence),0)=0 THEN NULL ELSE round(100.0 * SUM(paid) / SUM(amount_due_pence), 1) END AS rate
          FROM chg WHERE chg.venue_id = sv.id) x)
    )
  ) INTO v_result;

  RETURN jsonb_build_object('analytics', v_result, 'config', v_config,
    'caller', jsonb_build_object('actor_type', v_actor, 'role', v_role, 'region', v_region),
    'range', jsonb_build_object('from', p_date_from, 'to', p_date_to));
END;
$function$;
