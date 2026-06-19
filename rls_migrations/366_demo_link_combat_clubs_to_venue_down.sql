-- Down for 366: unlink the two combat clubs from demo_venue.
DELETE FROM public.club_venues
WHERE venue_id = 'demo_venue'
  AND club_id IN ('club_demo_box', 'club_demo_ma');
