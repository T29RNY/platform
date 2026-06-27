-- 444 DOWN: remove Epic B Phase 1 data foundation.
-- Drops the club-media write policies, deletes the bucket and its objects, then
-- drops the three tables (posts -> sponsors -> pages; all CASCADE-safe via FKs).

DROP POLICY IF EXISTS "club_media_insert" ON storage.objects;
DROP POLICY IF EXISTS "club_media_update" ON storage.objects;
DROP POLICY IF EXISTS "club_media_delete" ON storage.objects;

DELETE FROM storage.objects WHERE bucket_id = 'club-media';
DELETE FROM storage.buckets WHERE id = 'club-media';

DROP TABLE IF EXISTS public.club_posts;
DROP TABLE IF EXISTS public.club_sponsors;
DROP TABLE IF EXISTS public.club_pages;
