-- 270_membership_venue_customers_down.sql
-- Reverse of 270. Drops the 4 RPCs and the venue_customers table.
-- NOTE: dropping the table will fail if a later phase's FK (memberships)
-- references it — drop those first.

DROP FUNCTION IF EXISTS public.venue_list_customers_people(text,boolean);
DROP FUNCTION IF EXISTS public.venue_erase_customer(text,uuid);
DROP FUNCTION IF EXISTS public.venue_update_customer(text,uuid,text,text,text,text,date,uuid,boolean,text);
DROP FUNCTION IF EXISTS public.venue_create_customer(text,text,text,text,text,date,uuid,boolean);

DROP TABLE IF EXISTS public.venue_customers;
