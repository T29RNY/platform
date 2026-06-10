-- 246 DOWN: remove the venue-media storage bucket and its write policies.
-- Deletes any uploaded objects first (a bucket row cannot be removed while
-- objects reference it).

DROP POLICY IF EXISTS "venue_media_insert" ON storage.objects;
DROP POLICY IF EXISTS "venue_media_update" ON storage.objects;
DROP POLICY IF EXISTS "venue_media_delete" ON storage.objects;

DELETE FROM storage.objects WHERE bucket_id = 'venue-media';
DELETE FROM storage.buckets WHERE id = 'venue-media';
