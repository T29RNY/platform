-- Demo data seed for the Venue dashboard demo (session 74).
-- Target: venue 'demo_venue' (Demo Sports Centre), token demo_venue_token_DO_NOT_USE_IN_PROD.
-- Fills every venue screen for a compelling demo: tonight's fixtures (live +
-- to-assign + result), venue staff, team bookings (confirmed + a pending request),
-- charges/payments, live "ins" (4/7, 5/10, 3/10), cancellations log, and a spread
-- of customer statuses (new / healthy / lapsing / dormant).
--
-- IDEMPOTENT: re-running cleans its own rows first (upcoming bookings, the four
-- backdated seed dates, the 'Demo Night' fixtures, seed74 staff, seed74 cancels).
-- Safe to run against the live demo only. Applied via Supabase MCP session 74.

-- ── Batch 1: venue staff + tonight's fixtures ───────────────────────────────
delete from venue_staff where venue_id='demo_venue' and notes='seed74';
insert into venue_staff (venue_id,name,role,email,phone,whatsapp_number,preferred_channel,notes,active) values
 ('demo_venue','Jordan Avery','manager','jordan@demo.co','+447700900100','+447700900100','whatsapp','seed74',true),
 ('demo_venue','Casey Boone','reception','casey@demo.co','+447700900101',null,'email','seed74',true),
 ('demo_venue','Morgan Pitch','groundstaff',null,'+447700900102',null,'sms','seed74',true),
 ('demo_venue','Riley Hughes','admin','riley@demo.co',null,null,'email','seed74',false);

delete from fixtures where round_name='Demo Night';
insert into fixtures (competition_id, home_team_id, away_team_id, week_number, round_name, scheduled_date, kickoff_time, status, home_score, away_score, playing_area_id, official_id, actual_kickoff_at) values
 ('dc000000-0000-4000-8000-000000000002','team_dc_rovers','team_dc_city',99,'Demo Night', current_date,'19:00','in_progress',2,1,'c0f26961-9dfc-41a1-8e53-9c774d9f1f81','af9065ab-653a-4b85-91d5-c380653fecf0', now()-interval '34 min'),
 ('dc000000-0000-4000-8000-000000000002','team_dc_athletic','team_dc_fc',99,'Demo Night', current_date,'19:00','in_progress',0,0,'5b866896-d907-4e6e-b1be-ec23ba7e57c8','b61f2c2e-d08f-4794-a78f-8d687b39a1f3', now()-interval '12 min'),
 ('9c95ec8b-003a-4f27-9365-38e9ece5421e','team_demo_alpha','team_demo_bravo',99,'Demo Night', current_date,'20:15','scheduled',null,null,null,null,null),
 ('9c95ec8b-003a-4f27-9365-38e9ece5421e','team_demo_charlie','team_demo_delta',99,'Demo Night', current_date,'20:30','allocated',null,null,'5b866896-d907-4e6e-b1be-ec23ba7e57c8',null,null),
 ('9c95ec8b-003a-4f27-9365-38e9ece5421e','team_demo_echo','team_demo_alpha',99,'Demo Night', current_date,'18:00','completed',3,2,'c0f26961-9dfc-41a1-8e53-9c774d9f1f81','298ae709-52d4-4f31-a127-0b9656951b71', current_date+time '18:00');

-- ── Batch 2: bookings, charges, live ins, cancellations ─────────────────────
DO $$
DECLARE
  tok text := 'demo_venue_token_DO_NOT_USE_IN_PROD';
  pmain uuid := 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81';
  pside uuid := '5b866896-d907-4e6e-b1be-ec23ba7e57c8';
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; breq uuid; bc1 uuid; bc2 uuid;
BEGIN
  delete from pitch_occupancy where venue_id='demo_venue' and source_kind='booking'
    and source_id in (select id::text from pitch_bookings where venue_id='demo_venue' and booking_date >= current_date);
  delete from venue_payments where charge_id in (select id from venue_charges where venue_id='demo_venue' and source_type='booking'
    and source_id in (select id::text from pitch_bookings where venue_id='demo_venue' and booking_date >= current_date));
  delete from venue_charges where venue_id='demo_venue' and source_type='booking'
    and source_id in (select id::text from pitch_bookings where venue_id='demo_venue' and booking_date >= current_date);
  delete from audit_events where action='booking_cancelled' and metadata->>'venue_id'='demo_venue' and metadata->>'seed'='74';
  delete from pitch_bookings where venue_id='demo_venue' and booking_date >= current_date;

  b1   := (public.venue_create_booking(tok, pmain, current_date+2, '19:00', 60, 'team_dc_fc', null)->>'booking_id')::uuid;
  b2   := (public.venue_create_booking(tok, pmain, current_date+2, '20:00', 60, 'team_dc_rovers', null)->>'booking_id')::uuid;
  b3   := (public.venue_create_booking(tok, pside, current_date+5, '19:00', 90, 'team_dc_city', null)->>'booking_id')::uuid;
  b4   := (public.venue_create_booking(tok, pside, current_date+9, '18:30', 60, 'team_demo_alpha', null)->>'booking_id')::uuid;
  breq := (public.venue_create_booking(tok, pmain, current_date+3, '19:30', 60, 'team_dc_athletic', null)->>'booking_id')::uuid;
  update pitch_bookings set status='requested' where id=breq;
  bc1  := (public.venue_create_booking(tok, pside, current_date+1, '17:00', 60, 'team_demo_bravo', null)->>'booking_id')::uuid;
  bc2  := (public.venue_create_booking(tok, pmain, current_date+4, '21:00', 60, null, 'Lunchtime Casuals')->>'booking_id')::uuid;

  insert into venue_charges (venue_id, source_type, source_id, team_id, amount_due_pence, status, due_date) values
    ('demo_venue','booking',b1::text,'team_dc_fc',5000,'unpaid',current_date+2),
    ('demo_venue','booking',b2::text,'team_dc_rovers',5000,'unpaid',current_date+2),
    ('demo_venue','booking',b3::text,'team_dc_city',7500,'unpaid',current_date+5),
    ('demo_venue','booking',b4::text,'team_demo_alpha',5000,'unpaid',current_date+9),
    ('demo_venue','booking',bc1::text,'team_demo_bravo',5000,'unpaid',current_date+1),
    ('demo_venue','booking',bc2::text,null,5000,'unpaid',current_date+4);
  insert into venue_payments (charge_id, kind, amount_pence, method, taken_at)
    select id,'payment',5000,'card',now() from venue_charges where source_id=b1::text;
  insert into venue_payments (charge_id, kind, amount_pence, method, taken_at)
    select id,'payment',2500,'cash',now() from venue_charges where source_id=b3::text;
  perform public._recompute_charge_status(id) from venue_charges where source_id in (b1::text,b3::text);

  update schedule set squad_size=10, active=true where team_id in ('team_dc_rovers','team_dc_city');
  insert into schedule (id, team_id, squad_size, active) values
    ('sched_team_dc_rovers','team_dc_rovers',10,true), ('sched_team_dc_city','team_dc_city',10,true)
    on conflict (id) do update set squad_size=excluded.squad_size, active=true;
  update players set status='out' where id in (select player_id from team_players where team_id in ('team_dc_fc','team_dc_rovers','team_dc_city'));
  update players set status='in' where id in (select player_id from team_players where team_id='team_dc_fc' order by player_id limit 4);
  update players set status='in' where id in (select player_id from team_players where team_id='team_dc_rovers' order by player_id limit 5);
  update players set status='in' where id in (select player_id from team_players where team_id='team_dc_city' order by player_id limit 3);

  perform public.cancel_booking(bc1, tok, 'Weather', 'Pitch waterlogged [seed74]', 'full', false);
  perform public.cancel_booking(bc2, tok, 'Booker request', 'Rebooking later [seed74]', 'partial', true);
  update audit_events set metadata = metadata || '{"seed":"74"}'::jsonb where action='booking_cancelled' and entity_id in (bc1::text,bc2::text);
END $$;

-- ── Batch 3: customer status variety (backdated bookings) ───────────────────
DO $$
DECLARE
  tok text := 'demo_venue_token_DO_NOT_USE_IN_PROD';
  pmain uuid := 'c0f26961-9dfc-41a1-8e53-9c774d9f1f81';
  pside uuid := '5b866896-d907-4e6e-b1be-ec23ba7e57c8';
  d_dates date[] := array[current_date-72, current_date-45, current_date-25, current_date-12];
  bid uuid; dd date;
BEGIN
  delete from pitch_occupancy where venue_id='demo_venue' and source_kind='booking'
    and source_id in (select id::text from pitch_bookings where venue_id='demo_venue' and booking_date = any(d_dates));
  delete from venue_charges where venue_id='demo_venue' and source_type='booking'
    and source_id in (select id::text from pitch_bookings where venue_id='demo_venue' and booking_date = any(d_dates));
  delete from pitch_bookings where venue_id='demo_venue' and booking_date = any(d_dates);

  foreach dd in array array[current_date-25, current_date-12] loop  -- Competitive FC → Healthy (3 bookings)
    bid := (public.venue_create_booking(tok, pmain, dd, '19:00', 60, 'team_dc_fc', null)->>'booking_id')::uuid;
    update pitch_bookings set created_at = dd::timestamptz where id=bid;
    insert into venue_charges (venue_id, source_type, source_id, team_id, amount_due_pence, status, due_date) values ('demo_venue','booking',bid::text,'team_dc_fc',5000,'paid',dd);
  end loop;

  bid := (public.venue_create_booking(tok, pside, current_date-72, '18:00', 60, 'team_demo_charlie', null)->>'booking_id')::uuid;  -- Dormant
  update pitch_bookings set created_at = (current_date-72)::timestamptz where id=bid;
  insert into venue_charges (venue_id, source_type, source_id, team_id, amount_due_pence, status, due_date) values ('demo_venue','booking',bid::text,'team_demo_charlie',5000,'paid',current_date-72);

  bid := (public.venue_create_booking(tok, pmain, current_date-45, '20:00', 60, 'team_demo_delta', null)->>'booking_id')::uuid;  -- Lapsing
  update pitch_bookings set created_at = (current_date-45)::timestamptz where id=bid;
  insert into venue_charges (venue_id, source_type, source_id, team_id, amount_due_pence, status, due_date) values ('demo_venue','booking',bid::text,'team_demo_delta',5000,'paid',current_date-45);
END $$;
